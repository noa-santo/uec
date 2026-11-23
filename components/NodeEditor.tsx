import { Text, View } from "react-native";

export function NodeEditor() {
  return (
    <View style={{ flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <Text style={{ color: "#fff", fontSize: 18, fontWeight: "700", marginBottom: 8 }}>Node-based Editor</Text>
      <Text style={{ color: "#bbb", textAlign: "center" }}>The visual editor is available on web and desktop. Use the web editor to configure routing rules.</Text>
    </View>
  );
}
