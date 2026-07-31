import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"

import { authorizeCredentials } from "@/lib/auth/credentials"

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Fuera de Vercel (Cloudflare Workers) Auth.js no puede auto-detectar el host
  // y rechaza toda request con UntrustedHost. El host real lo fija el custom
  // domain del Worker, así que confiar en el header es seguro aquí.
  trustHost: true,
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const user = await authorizeCredentials(
          credentials?.email,
          credentials?.password
        )

        if (!user) return null

        return {
          id: user.id,
          email: user.email,
        }
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user?.id) token.id = user.id
      return token
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = String(token.id ?? token.sub)
      }
      return session
    },
  },
})
