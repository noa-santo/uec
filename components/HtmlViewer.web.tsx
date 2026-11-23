import React from "react";

export function HtmlViewer({ html }: { html: string }) {
  const documentHtml = `<!doctype html><html lang=""><head><meta charset='utf-8'/><meta name='viewport' content='width=device-width,initial-scale=1'/><style>body{color:#fff;background:#000;font-family:-apple-system,system-ui,sans-serif;padding:12px;}a{color:#7ab7ff}img{max-width:100%;height:auto}</style></head><body>${html}</body></html>`;
  return <iframe title="Email content" sandbox="" srcDoc={documentHtml} style={{ backgroundColor: "#000", border: 0, width: "100%", height: "100%", borderRadius: 8 }} />;
}
