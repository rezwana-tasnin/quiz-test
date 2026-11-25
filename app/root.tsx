import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";

import type { Route } from "./+types/root";
import "./app.css";

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=Plus+Jakarta+Sans:ital,wght@0,400..800;1,400..800&display=swap",
  },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="bn">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#0b1526" />
        <Meta />
        <Links />
        <style
          dangerouslySetInnerHTML={{
            __html: `
              html, body {
                margin: 0;
                min-height: 100%;
                background: #0b1526 !important;
                color: #14213d !important;
              }
              #root, body > div {
                min-height: 100vh;
              }
            `,
          }}
        />
      </head>
      <body style={{ margin: 0, minHeight: "100vh", background: "#0b1526", color: "#14213d" }}>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Something went wrong";
  let details = "Please refresh and try again.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "Page not found" : "Error";
    details =
      error.status === 404
        ? "This route does not exist."
        : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main
      style={{
        display: "grid",
        placeItems: "center",
        padding: 24,
        minHeight: "100vh",
        background: "#0b1526",
        color: "#fff",
        fontFamily: '"Plus Jakarta Sans", system-ui, sans-serif',
        textAlign: "center",
      }}
    >
      <div
        style={{
          maxWidth: 420,
          width: "100%",
          borderRadius: 28,
          padding: "32px 28px",
          background: "rgba(255,255,255,0.96)",
          color: "#14213d",
          boxShadow: "0 24px 60px -20px rgba(0,0,0,0.55)",
        }}
      >
        <p
          style={{
            margin: "0 0 8px",
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "#ff5a3d",
          }}
        >
          Quiz Test
        </p>
        <h1 style={{ margin: "0 0 8px", fontSize: 28, fontWeight: 800 }}>
          {message}
        </h1>
        <p style={{ margin: 0, fontSize: 15, color: "#3d4a66" }}>{details}</p>
        {stack && (
          <pre
            style={{
              marginTop: 16,
              whiteSpace: "pre-wrap",
              textAlign: "left",
              background: "#f7f9fc",
              padding: 12,
              borderRadius: 12,
              fontSize: 12,
              overflow: "auto",
            }}
          >
            <code>{stack}</code>
          </pre>
        )}
      </div>
    </main>
  );
}
