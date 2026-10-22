import { verify } from "@node-rs/argon2";
import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { one } from "@/db";

declare module "next-auth" {
  interface Session {
    user: { id: string } & DefaultSession["user"];
  }
}

const credentials = z.object({ email: z.string().email(), password: z.string().min(1) });

// Credentials sign-in needs JWT sessions in Auth.js. The token holds only the user id.
export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 14 },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(raw) {
        const parsed = credentials.safeParse(raw);
        if (!parsed.success) return null;
        const user = await one<{ id: string; email: string; name: string | null; password_hash: string | null }>(
          "select id, email, name, password_hash from users where email = $1",
          [parsed.data.email],
        );
        if (!user?.password_hash) return null;
        if (!(await verify(user.password_hash, parsed.data.password))) return null;
        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      return session;
    },
  },
});
