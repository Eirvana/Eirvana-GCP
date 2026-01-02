import React, { useEffect, useState } from "react";
import { View, Text, Button, StyleSheet, ScrollView } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

const API_URL = "https://eir-backend-493785333909.us-central1.run.app";

type DashboardData = {
  date: string;
  userId: string;
  symptoms: any | null;
  fitbit: {
    date: string;
    steps: number;
    calories: number;
    sleepMinutes: number;
  } | null;
};

export default function DashboardScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ userId?: string; name?: string }>();
  const userId = params.userId || "demo-user-1";
  const name = params.name || "";

  const [data, setData] = useState<DashboardData | null>(null);
  const [status, setStatus] = useState("");

  const loadDashboard = async () => {
    try {
      setStatus("Loading dashboard...");

      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      const dd = String(now.getDate()).padStart(2, "0");
      const dateStr = `${yyyy}-${mm}-${dd}`;

      const res = await fetch(
        `${API_URL}/dashboard/day?userId=${encodeURIComponent(
          String(userId)
        )}&date=${dateStr}`
      );
      const json = await res.json();
      setData(json);
      setStatus(`Dashboard loaded for ${json.date} ✅`);
    } catch (e: any) {
      console.log(e);
      setStatus("Error loading dashboard: " + e.message);
    }
  };


  useEffect(() => {
    loadDashboard();
  }, []);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Today at a glance</Text>
      <Text style={styles.subtitle}>
        {name ? `Hi ${name}, here’s your day.` : "Here’s your day."}
      </Text>

      <Text style={styles.status}>{status}</Text>

      {data && (
        <>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Fitbit</Text>
            {data.fitbit ? (
              <>
                <Text>Date: {data.fitbit.date}</Text>
                <Text>Steps: {data.fitbit.steps}</Text>
                <Text>Calories: {data.fitbit.calories}</Text>
                <Text>Sleep: {data.fitbit.sleepMinutes} minutes</Text>
              </>
            ) : (
              <Text>No Fitbit data for this day.</Text>
            )}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Symptoms</Text>
            {data.symptoms ? (
              <>
                <Text>Date: {data.symptoms.date}</Text>
                <Text>
                  Symptoms:{" "}
                  {typeof data.symptoms.symptoms === "object"
                    ? JSON.stringify(data.symptoms.symptoms)
                    : String(data.symptoms.symptoms)}
                </Text>
                {data.symptoms.notes ? (
                  <Text>Notes: {data.symptoms.notes}</Text>
                ) : null}
              </>
            ) : (
              <Text>No symptom entry for this day.</Text>
            )}
          </View>
        </>
      )}

      <View style={{ marginTop: 24 }}>
        <Button title="Refresh" onPress={loadDashboard} />
      </View>

      <View style={{ marginTop: 12 }}>
        <Button
          title="Record today's symptoms"
          onPress={() =>
            router.push({
              pathname: "/symptoms",
              params: { userId, name },
            })
          }
        />
      </View>

      <View style={{ marginTop: 12 }}>
        <Button
          title="Back to Connect Devices"
          onPress={() =>
            router.push({
              pathname: "/connect-devices",
              params: { userId, name },
            })
          }
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 24, justifyContent: "center" },
  title: { fontSize: 24, fontWeight: "700", marginBottom: 4 },
  subtitle: { fontSize: 16, marginBottom: 16 },
  status: { marginBottom: 16, color: "gray" },
  card: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  },
  cardTitle: { fontWeight: "700", marginBottom: 8 },
});
