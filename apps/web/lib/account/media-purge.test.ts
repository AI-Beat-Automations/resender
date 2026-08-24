import { beforeEach, describe, expect, it, vi } from "vitest"

const { sqlMock, sendMock } = vi.hoisted(() => ({
  sqlMock: vi.fn(),
  sendMock: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  getSql: () => sqlMock,
}))

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({ env: { WHATSAPP_JOBS: { send: sendMock } } }),
}))

import {
  MAX_PURGE_ATTEMPTS,
  deletePendingMediaDeletion,
  enqueueMediaPurge,
  handleMediaPurgeJob,
  insertPendingMediaDeletion,
  listPendingMediaDeletions,
  planPurgeStep,
  purgeMediaPrefix,
  recordPurgeAttempt,
  recoverPendingMediaPurges,
  selectPurgesToRetry,
  shouldGiveUpOnPurge,
  tenantMediaPrefix,
} from "./media-purge"

// Junta el SQL de la última query en una sola línea, para poder afirmar sobre
// la forma de la sentencia sin pelearse con la indentación del template.
function lastQuery(): { text: string; params: unknown[] } {
  const call = sqlMock.mock.calls.at(-1)
  const [strings, ...params] = call as [TemplateStringsArray, ...unknown[]]
  return {
    text: strings.join(" ? ").replace(/\s+/g, " ").trim(),
    params,
  }
}

// Doble de R2 que sirve listados guionados y anota los borrados.
function fakeBucket(listings: R2Objects[]) {
  const deleted: string[][] = []
  const listCalls: R2ListOptions[] = []
  let index = 0
  const bucket = {
    list: async (options?: R2ListOptions) => {
      listCalls.push(options ?? {})
      return listings[Math.min(index++, listings.length - 1)]
    },
    delete: async (keys: string | string[]) => {
      deleted.push(Array.isArray(keys) ? keys : [keys])
    },
  } as unknown as R2Bucket
  return { bucket, deleted, listCalls }
}

function listing(
  keys: string[],
  extra: { truncated?: boolean; cursor?: string } = {}
): R2Objects {
  return {
    objects: keys.map((key) => ({ key }) as R2Object),
    truncated: extra.truncated ?? false,
    cursor: extra.cursor,
  }
}

beforeEach(() => {
  sqlMock.mockReset()
  sqlMock.mockResolvedValue([])
  sendMock.mockReset()
  sendMock.mockResolvedValue(undefined)
})

describe("tenantMediaPrefix", () => {
  it("builds the per-tenant prefix with a trailing slash", () => {
    // Sin la barra final, el prefijo de un tenant alcanzaría al de otro cuyo id
    // empezara igual.
    expect(tenantMediaPrefix("tenant-1")).toBe("wa/tenant-1/")
  })
})

describe("planPurgeStep", () => {
  it("is only done when a non-truncated listing came back empty", () => {
    expect(planPurgeStep(listing([]))).toEqual({
      keys: [],
      nextCursor: null,
      done: true,
    })
  })

  it("is not done while the last page still had objects", () => {
    // Esta es la vuelta de más que separa «borré todo» de «R2 dice que no queda
    // nada»: hay 2 claves por borrar y recién el listado siguiente lo confirma.
    expect(planPurgeStep(listing(["a", "b"]))).toEqual({
      keys: ["a", "b"],
      nextCursor: null,
      done: false,
    })
  })

  it("carries the cursor forward while the listing is truncated", () => {
    expect(
      planPurgeStep(listing(["a"], { truncated: true, cursor: "c1" }))
    ).toEqual({ keys: ["a"], nextCursor: "c1", done: false })
  })

  it("restarts from the beginning when a truncated listing has no cursor", () => {
    const step = planPurgeStep(listing(["a"], { truncated: true }))
    expect(step.done).toBe(false)
    expect(step.nextCursor).toBeNull()
  })
})

describe("give-up rule", () => {
  it("keeps retrying below the cap and stops at it", () => {
    expect(shouldGiveUpOnPurge(0)).toBe(false)
    expect(shouldGiveUpOnPurge(MAX_PURGE_ATTEMPTS - 1)).toBe(false)
    expect(shouldGiveUpOnPurge(MAX_PURGE_ATTEMPTS)).toBe(true)
  })

  it("filters out the exhausted rows without dropping them", () => {
    const rows = [
      { id: "a", r2Prefix: "wa/a/", attempts: 0, lastError: null },
      {
        id: "b",
        r2Prefix: "wa/b/",
        attempts: MAX_PURGE_ATTEMPTS,
        lastError: "boom",
      },
    ]
    expect(selectPurgesToRetry(rows).map((row) => row.id)).toEqual(["a"])
  })
})

describe("purgeMediaPrefix", () => {
  it("deletes the listed page and reports the next cursor", async () => {
    const { bucket, deleted, listCalls } = fakeBucket([
      listing(["wa/t/1", "wa/t/2"], { truncated: true, cursor: "c1" }),
    ])

    const result = await purgeMediaPrefix({ bucket, prefix: "wa/t/" })

    expect(listCalls[0]).toEqual({
      prefix: "wa/t/",
      limit: 1000,
      cursor: undefined,
    })
    expect(deleted).toEqual([["wa/t/1", "wa/t/2"]])
    expect(result).toEqual({ deleted: 2, nextCursor: "c1", done: false })
  })

  it("resumes from the cursor it is given", async () => {
    const { bucket, listCalls } = fakeBucket([listing([])])
    await purgeMediaPrefix({ bucket, prefix: "wa/t/", cursor: "c1" })
    expect(listCalls[0]?.cursor).toBe("c1")
  })

  it("is a no-op success on an already empty prefix", async () => {
    // Idempotencia: es el caso del mensaje repetido y el del cron reclamando un
    // prefijo que ya se vació.
    const { bucket, deleted } = fakeBucket([listing([])])
    const result = await purgeMediaPrefix({ bucket, prefix: "wa/t/" })
    expect(deleted).toEqual([])
    expect(result).toEqual({ deleted: 0, nextCursor: null, done: true })
  })
})

describe("handleMediaPurgeJob", () => {
  const pendingRow = {
    id: "pending-1",
    r2_prefix: "wa/t/",
    attempts: 0,
    last_error: null,
  }

  it("re-enqueues with the cursor and leaves the row alone", async () => {
    sqlMock.mockResolvedValueOnce([pendingRow])
    const { bucket } = fakeBucket([
      listing(["wa/t/1"], { truncated: true, cursor: "c1" }),
    ])

    const result = await handleMediaPurgeJob({
      env: { WHATSAPP_MEDIA: bucket, WHATSAPP_JOBS: { send: sendMock } },
      prefix: "wa/t/",
    })

    expect(result).toEqual({ deleted: 1, done: false, continued: true })
    expect(sendMock).toHaveBeenCalledWith({
      type: "media_purge",
      prefix: "wa/t/",
      cursor: "c1",
    })
    // Una sola query: la que buscó la fila. No se borró nada de Postgres.
    expect(sqlMock).toHaveBeenCalledTimes(1)
  })

  it("deletes the row only when R2 confirms the prefix is empty", async () => {
    sqlMock.mockResolvedValueOnce([pendingRow])
    const { bucket } = fakeBucket([listing([])])

    const result = await handleMediaPurgeJob({
      env: { WHATSAPP_MEDIA: bucket, WHATSAPP_JOBS: { send: sendMock } },
      prefix: "wa/t/",
    })

    expect(result).toEqual({ deleted: 0, done: true, continued: false })
    expect(sendMock).not.toHaveBeenCalled()
    expect(lastQuery().text).toContain("delete from pending_media_deletions")
    expect(lastQuery().params).toEqual(["pending-1"])
  })

  it("keeps the row and does not delete it when the last page still had objects", async () => {
    // No truncado pero con objetos: se borran, y la fila sigue viva hasta que
    // una vuelta posterior vea el prefijo vacío.
    sqlMock.mockResolvedValueOnce([pendingRow])
    const { bucket, deleted } = fakeBucket([listing(["wa/t/1"])])

    const result = await handleMediaPurgeJob({
      env: { WHATSAPP_MEDIA: bucket, WHATSAPP_JOBS: { send: sendMock } },
      prefix: "wa/t/",
    })

    expect(deleted).toEqual([["wa/t/1"]])
    expect(result.done).toBe(false)
    expect(sendMock).toHaveBeenCalledWith({
      type: "media_purge",
      prefix: "wa/t/",
    })
    expect(sqlMock).toHaveBeenCalledTimes(1)
  })

  it("records the attempt and rethrows when R2 fails", async () => {
    sqlMock.mockResolvedValueOnce([pendingRow])
    const bucket = {
      list: async () => {
        throw new Error("r2 down")
      },
      delete: async () => {},
    } as unknown as R2Bucket

    await expect(
      handleMediaPurgeJob({
        env: { WHATSAPP_MEDIA: bucket, WHATSAPP_JOBS: { send: sendMock } },
        prefix: "wa/t/",
      })
    ).rejects.toThrow("r2 down")

    const query = lastQuery()
    expect(query.text).toContain("attempts = attempts + 1")
    expect(query.params).toEqual(["r2 down", "pending-1"])
  })

  it("still succeeds when the row is already gone", async () => {
    // Mensaje repetido sobre un prefijo ya purgado: nada que borrar en R2 ni en
    // Postgres, y no es un error.
    sqlMock.mockResolvedValueOnce([])
    const { bucket } = fakeBucket([listing([])])

    const result = await handleMediaPurgeJob({
      env: { WHATSAPP_MEDIA: bucket, WHATSAPP_JOBS: { send: sendMock } },
      prefix: "wa/t/",
    })

    expect(result.done).toBe(true)
    expect(sqlMock).toHaveBeenCalledTimes(1)
  })
})

describe("repository helpers", () => {
  it("inserts the prefix ignoring conflicts", async () => {
    await insertPendingMediaDeletion("wa/t/")
    const query = lastQuery()
    expect(query.text).toContain("insert into pending_media_deletions")
    expect(query.text).toContain("on conflict (r2_prefix) do nothing")
    expect(query.params).toEqual(["wa/t/"])
  })

  it("maps the pending rows to camelCase", async () => {
    sqlMock.mockResolvedValueOnce([
      { id: "p1", r2_prefix: "wa/t/", attempts: 2, last_error: "boom" },
    ])
    expect(await listPendingMediaDeletions()).toEqual([
      { id: "p1", r2Prefix: "wa/t/", attempts: 2, lastError: "boom" },
    ])
  })

  it("bumps attempts without deleting the row", async () => {
    await recordPurgeAttempt("p1", "boom")
    const query = lastQuery()
    expect(query.text).toContain("update pending_media_deletions")
    expect(query.text).not.toContain("delete")
    expect(query.params).toEqual(["boom", "p1"])
  })

  it("deletes by id", async () => {
    await deletePendingMediaDeletion("p1")
    expect(lastQuery().params).toEqual(["p1"])
  })
})

describe("enqueueMediaPurge", () => {
  it("omits the cursor on a fresh purge", async () => {
    await enqueueMediaPurge({ prefix: "wa/t/" })
    expect(sendMock).toHaveBeenCalledWith({
      type: "media_purge",
      prefix: "wa/t/",
    })
  })

  it("falls back to the Cloudflare binding when no queue is injected", async () => {
    await enqueueMediaPurge({ prefix: "wa/t/", cursor: "c1" })
    expect(sendMock).toHaveBeenCalledWith({
      type: "media_purge",
      prefix: "wa/t/",
      cursor: "c1",
    })
  })
})

describe("recoverPendingMediaPurges", () => {
  it("re-enqueues only the rows that still have attempts left", async () => {
    sqlMock.mockResolvedValueOnce([
      { id: "p1", r2_prefix: "wa/a/", attempts: 1, last_error: null },
      {
        id: "p2",
        r2_prefix: "wa/b/",
        attempts: MAX_PURGE_ATTEMPTS,
        last_error: "boom",
      },
    ])

    const count = await recoverPendingMediaPurges({
      WHATSAPP_MEDIA: {} as unknown as R2Bucket,
      WHATSAPP_JOBS: { send: sendMock },
    })

    expect(count).toBe(1)
    expect(sendMock).toHaveBeenCalledTimes(1)
    expect(sendMock).toHaveBeenCalledWith({
      type: "media_purge",
      prefix: "wa/a/",
    })
  })
})
