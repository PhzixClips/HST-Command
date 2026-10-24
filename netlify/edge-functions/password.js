// Password-protects the whole site before any page or script is served.
// The password lives in the Netlify environment variable SITE_PASSWORD,
// never in this repo. If the variable is missing, the site stays locked.

export default async (request, context) => {
  const expected = Netlify.env.get("SITE_PASSWORD");

  if (!expected) {
    return new Response("Site locked: SITE_PASSWORD is not set in Netlify.", {
      status: 503,
      headers: { "Content-Type": "text/plain" },
    });
  }

  const header = request.headers.get("authorization") || "";
  if (header.startsWith("Basic ")) {
    try {
      const bytes = Uint8Array.from(atob(header.slice(6).trim()), c => c.charCodeAt(0));
      const decoded = new TextDecoder().decode(bytes);
      const password = decoded.slice(decoded.indexOf(":") + 1).trim();
      if (safeEqual(password, expected.trim())) return context.next();
    } catch {
      // malformed header, fall through to the prompt
    }
  }

  return new Response("Password required.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="HST Command", charset="UTF-8"',
      "Content-Type": "text/plain",
      "Cache-Control": "no-store",
    },
  });
};

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const config = { path: "/*" };
