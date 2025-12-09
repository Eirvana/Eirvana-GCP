import React, { useEffect, useState } from "react";
import { View, Text, Button, StyleSheet } from "react-native";
import { useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";

const API_URL = "https://eir-backend-493785333909.us-central1.run.app";

export default function ConnectDevicesScreen() {
  const params = useLocalSearchParams<{ userId?: string; name?: string }>();
  const userId = params.userId || "demo-user-1";
  const name = params.name || "";

  const [status, setStatus] = useState("");
  const [fitbitConnected, setFitbitConnected] = useState(false);

  const checkFitbitStatus = async () => {
    try {
      const res = await fetch(
        `${API_URL}/fitbit/status?userId=${encodeURIComponent(
          String(userId)
        )}`
      );
      const data = await res.json();
      setFitbitConnected(!!data.connected);
      if (data.connected) {
        setStatus("Fitbit is connected ✅");
      }
    } catch (e: any) {
      console.log(e);
    }
  };

  useEffect(() => {
    checkFitbitStatus();
  }, []);

  const connectFitbit = async () => {
    try {
      setStatus("Opening Fitbit...");
      const res = await fetch(
        `${API_URL}/fitbit/auth-url?userId=${encodeURIComponent(
          String(userId)
        )}`
      );
      const data = await res.json();
      if (!data.url) {
        setStatus("Failed to get Fitbit URL");
        return;
      }
      await WebBrowser.openBrowserAsync(data.url);
      setStatus(
        "Fitbit page opened. Complete login, then return here and tap 'Check connection'."
      );
    } catch (e: any) {
      console.log(e);
      setStatus("Error starting Fitbit connect: " + e.message);
    }
  };

  const connectOura = () => {
    setStatus("Oura integration coming soon.");
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Hi {name || "there"} 👋</Text>
      <Text style={styles.subtitle}>
        Do you want to connect your wearables now?
      </Text>

      <View style={styles.buttonWrapper}>
        <Button
          title={fitbitConnected ? "Fitbit connected ✅" : "Connect Fitbit"}
          onPress={connectFitbit}
        />
      </View>

      <View style={styles.buttonWrapper}>
        <Button title="Check Fitbit connection" onPress={checkFitbitStatus} />
      </View>

      <View style={styles.buttonWrapper}>
        <Button title="Connect Oura (coming soon)" onPress={connectOura} />
      </View>

      {status ? <Text style={styles.status}>{status}</Text> : null}

      <Text style={styles.note}>
        You can always connect devices later in Settings.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, justifyContent: "center" },
  title: { fontSize: 26, fontWeight: "700", marginBottom: 8 },
  subtitle: { fontSize: 16, marginBottom: 24 },
  buttonWrapper: { marginVertical: 8 },
  status: { marginTop: 16, color: "gray" },
  note: { marginTop: 24, fontSize: 12, color: "gray" },
});
