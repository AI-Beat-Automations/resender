export type AccountDict = {
  title: string
  emailLabel: string
  tenantIdLabel: string
  copyTenantId: string
  passwordTitle: string
  passwordBody: string
  newPassword: string
  newPasswordPlaceholder: string
  confirmPassword: string
  confirmPasswordPlaceholder: string
  passwordHint: string
  passwordSubmit: string
  deleteTitle: string
  deleteBody: string
  deleteCta: string
  deleteDialogTitle: string
  deleteDialogBody: string
  /** `{email}` — el label lleva el email en `<span>`, así que va partido. */
  deleteConfirmBefore: string
  deleteConfirmAfter: string
  deleteConfirm: string
  deleting: string
  /**
   * Panel «Cómo entras a Resender» ([Cuenta vinculada], issue #98): la fila
   * de estado del correo arriba —solo si no está confirmado—, y debajo las
   * credenciales. `unlink` no se ofrece cuando es la única (la librería
   * rechaza quitar la última) y `link` va deshabilitado con
   * `linkRequiresVerified` al lado mientras el correo no esté confirmado.
   */
  signInMethods: {
    title: string
    body: string
    emailUnverified: string
    emailUnverifiedHint: string
    resend: string
    resendSent: string
    password: string
    passwordConfigured: string
    passwordMissing: string
    google: string
    googleNotLinked: string
    link: string
    linkRequiresVerified: string
    unlink: string
    unlinkHint: string
    lastCredentialHint: string
    linked: string
  }
}

export const es: AccountDict = {
  title: "Cuenta",
  emailLabel: "email",
  tenantIdLabel: "tenant_id",
  copyTenantId: "Copiar el identificador de cuenta",
  passwordTitle: "Cambiar contraseña",
  passwordBody:
    "Define una contraseña nueva. Al guardarla cerramos tu sesión y tendrás que iniciar de nuevo.",
  newPassword: "Contraseña nueva",
  newPasswordPlaceholder: "Al menos 8 caracteres",
  confirmPassword: "Repetir contraseña",
  confirmPasswordPlaceholder: "Repite la contraseña nueva",
  passwordHint: "Mínimo 8 caracteres.",
  passwordSubmit: "Cambiar contraseña",
  deleteTitle: "Eliminar cuenta",
  deleteBody:
    "Borra definitivamente tu cuenta y todos tus datos: páginas conectadas, conversaciones, mensajes y API keys. Antes de borrar intentamos desuscribir tus páginas del webhook de Meta. Es inmediato y no se puede deshacer; las copias de respaldo se purgan en 30 días.",
  deleteCta: "Eliminar cuenta",
  deleteDialogTitle: "Eliminar tu cuenta",
  deleteDialogBody:
    "Se borran tu cuenta, tus páginas conectadas, tus conversaciones, tus mensajes y tus API keys. Es inmediato y no se puede deshacer.",
  deleteConfirmBefore: "Escribe ",
  deleteConfirmAfter: " para confirmar",
  deleteConfirm: "Sí, eliminar mi cuenta",
  deleting: "Eliminando…",
  signInMethods: {
    title: "Cómo entras a Resender",
    body: "Cada forma de entrar es independiente: vincular Google no borra tu contraseña.",
    emailUnverified: "Correo sin confirmar",
    emailUnverifiedHint: "Confírmalo para poder vincular Google.",
    resend: "Reenviar confirmación",
    resendSent: "Listo, te lo reenviamos.",
    password: "Contraseña",
    passwordConfigured: "Configurada",
    passwordMissing: "Sin configurar",
    google: "Google",
    googleNotLinked: "No vinculado",
    link: "Vincular",
    linkRequiresVerified: "Confirma tu correo primero",
    unlink: "Desvincular",
    unlinkHint: "Desvincular pide una sesión reciente.",
    lastCredentialHint: "Es tu única forma de entrar; no se puede quitar.",
    linked: "Vinculado",
  },
}

export const en: AccountDict = {
  title: "Account",
  emailLabel: "email",
  tenantIdLabel: "tenant_id",
  copyTenantId: "Copy the account identifier",
  passwordTitle: "Change password",
  passwordBody:
    "Set a new password. When you save it we sign you out and you'll have to sign in again.",
  newPassword: "New password",
  newPasswordPlaceholder: "At least 8 characters",
  confirmPassword: "Repeat password",
  confirmPasswordPlaceholder: "Repeat the new password",
  passwordHint: "At least 8 characters.",
  passwordSubmit: "Change password",
  deleteTitle: "Delete account",
  deleteBody:
    "Permanently deletes your account and all your data: connected pages, conversations, messages and API keys. Before deleting we try to unsubscribe your pages from Meta's webhook. It's immediate and can't be undone; backups are purged within 30 days.",
  deleteCta: "Delete account",
  deleteDialogTitle: "Delete your account",
  deleteDialogBody:
    "Your account, your connected pages, your conversations, your messages and your API keys are deleted. It's immediate and can't be undone.",
  deleteConfirmBefore: "Type ",
  deleteConfirmAfter: " to confirm",
  deleteConfirm: "Yes, delete my account",
  deleting: "Deleting…",
  signInMethods: {
    title: "How you sign in to Resender",
    body: "Each way in is independent: linking Google doesn't remove your password.",
    emailUnverified: "Email not confirmed",
    emailUnverifiedHint: "Confirm it to be able to link Google.",
    resend: "Resend confirmation",
    resendSent: "Done, we sent it again.",
    password: "Password",
    passwordConfigured: "Set",
    passwordMissing: "Not set",
    google: "Google",
    googleNotLinked: "Not linked",
    link: "Link",
    linkRequiresVerified: "Confirm your email first",
    unlink: "Unlink",
    unlinkHint: "Unlinking requires a recent session.",
    lastCredentialHint: "It's your only way in; it can't be removed.",
    linked: "Linked",
  },
}
