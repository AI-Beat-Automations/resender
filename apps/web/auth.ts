import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"

import { authenticateUser } from "@/lib/auth/users"

export const { handlers, auth, signIn, signOut } = NextAuth({
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
        const user = await authenticateUser(
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
