import React from "react";
import { DimensionValue, View } from "react-native";
import { WebView } from "react-native-webview";

export function HtmlViewer({ html }: { html: string }) {
  const documentHtml = `<!doctype html><html lang=""><head><meta charset='utf-8'/><meta name='viewport' content='width=device-width,initial-scale=1'/><style>body{color:#fff;background:#000;font-family:-apple-system,system-ui,sans-serif;padding:12px;} a{color:#7ab7ff} img{max-width:100%;height:auto}</style></head><body>${html}</body></html>`;
  return <View style={{ borderRadius: 8, overflow: "hidden", borderWidth: 1, borderColor: "#111", alignSelf: "stretch", height: "100%" as DimensionValue }}>
    <WebView originWhitelist={["*"]} javaScriptEnabled={false} domStorageEnabled={false} source={{ html: documentHtml }} style={{ backgroundColor: "#000", flex: 1 }} />
  </View>;
}
