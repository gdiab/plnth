import { apexHeaders } from "@/lib/headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Thank-you page for comment submissions. Displayed after a classic form POST
 * from sandboxed artifacts (since they can't use fetch with allow-same-origin).
 */
export function GET(): Response {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>Thank you</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      background: #f7f7f7;
      color: #333;
      padding: 1rem;
    }
    .card {
      background: white;
      border-radius: 8px;
      padding: 2rem;
      max-width: 28rem;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      text-align: center;
    }
    h1 {
      font-size: 1.5rem;
      font-weight: 500;
      margin-bottom: 0.75rem;
      color: #2d6a4f;
    }
    p {
      line-height: 1.6;
      color: #666;
    }
    a {
      display: inline-block;
      margin-top: 1.5rem;
      color: #2d6a4f;
      text-decoration: none;
      border-bottom: 1px solid #2d6a4f;
      padding-bottom: 2px;
    }
    a:hover {
      color: #1e4d36;
      border-bottom-color: #1e4d36;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>✓ Thank you</h1>
    <p>Your feedback has been received.</p>
    <a href="javascript:history.back()">← Return to the page</a>
  </div>
</body>
</html>`;

  const headers = apexHeaders();
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(html, { status: 200, headers });
}
