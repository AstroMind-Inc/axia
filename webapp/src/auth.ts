import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

/**
 * Auth.js (next-auth v5) with Google OAuth and JWT sessions.
 *
 * `session.user.id` is the Google account `sub`. That value is the only
 * identity stored on chat threads, uploads, and settings. Client-supplied
 * user ids are ignored.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),
  ],
  session: { strategy: "jwt" },
  trustHost: true,
  pages: {
    signIn: "/login",
  },
  callbacks: {
    jwt({ token, account, profile }) {
      if (account?.provider === "google") {
        const sub = typeof profile?.sub === "string" ? profile.sub : undefined;
        if (sub) {
          token.id = sub;
          token.sub = sub;
        }
      }
      return token;
    },
    session({ session, token }) {
      const id = (token.id as string | undefined) || token.sub;
      if (session.user && id) {
        session.user.id = id;
      }
      return session;
    },
  },
});
