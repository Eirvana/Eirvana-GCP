import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Button,
  StyleSheet,
  ScrollView,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

const API_URL = "https://eir-backend-493785333909.us-central1.run.app";

export default function SymptomsScreen() {
  const params = useLocalSearchParams<{ userId?: string; name?: string }>();
  const userId = params.userId || "demo-user-1";
  const name = params.name || "";
  const router = useRouter();

  // Symptom states
  const [hotFlashes, setHotFlashes] = useState("0");
  const [nightSweats, setNightSweats] = useState("0");
  const [mood, setMood] = useState("5");
  const [sleepQuality, setSleepQuality] = useState("5");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState("");

  const saveSymptoms = async () => {
    try {
      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      const dd = String(now.getDate()).padStart(2, "0");
      const date = `${yyyy}-${mm}-${dd}`;

      const body = {
        userId,
        date,
        symptoms: {
          hotFlashes: Number(hotFlashes),
          nightSweats: Number(nightSweats),
          mood: Number(mood),
          sleepQuality: Number(sleepQuality),
        },
        notes,
      };

      setStatus("Saving...");

      const res = await fetch(`${API_URL}/symptoms/today`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        setStatus(`Error: ${data.error}`);
        return;
      }

      setStatus("Saved! ✅");

      // Redirect to dashboard after saving
      router.push({
        pathname: "/dashboard",
        params: { userId, name },
      });
    } catch (e: any) {
      setStatus("Error saving: " + e.message);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Log Your Symptoms</Text>
      <Text style={styles.subtitle}>Hi {name}, how are you today?</Text>

      {/* Hot flashes */}
      <Text style={styles.label}>Hot Flashes (0–10)</Text>
      <TextInput
        style={styles.input}
        keyboardType="numeric"
        value={hotFlashes}
        onChangeText={setHotFlashes}
      />

      {/* Night sweats */}
      <Text style={styles.label}>Night Sweats (0–10)</Text>
      <TextInput
        style={styles.input}
        keyboardType="numeric"
        value={nightSweats}
        onChangeText={setNightSweats}
      />

      {/* Mood */}
      <Text style={styles.label}>Mood (0–10)</Text>
      <TextInput
        style={styles.input}
        keyboardType="numeric"
        value={mood}
        onChangeText={setMood}
      />

      {/* Sleep Quality */}
      <Text style={styles.label}>Sleep Quality (0–10)</Text>
      <TextInput
        style={styles.input}
        keyboardType="numeric"
        value={sleepQuality}
        onChangeText={setSleepQuality}
      />

      {/* Notes */}
      <Text style={styles.label}>Notes (optional)</Text>
      <TextInput
        style={[styles.input, { height: 80 }]}
        multiline
        value={notes}
        onChangeText={setNotes}
      />

      {/* Save Button */}
      <View style={{ marginTop: 20 }}>
        <Button title="Save Symptoms" onPress={saveSymptoms} />
      </View>

      <Text style={styles.status}>{status}</Text>

      {/* Back button */}
      <View style={{ marginTop: 20 }}>
        <Button
          title="Back to Dashboard"
          onPress={() =>
            router.push({
              pathname: "/dashboard",
              params: { userId, name },
            })
          }
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24 },
  title: { fontSize: 28, fontWeight: "700", marginBottom: 10 },
  subtitle: { fontSize: 16, marginBottom: 20 },
  label: { marginTop: 16, marginBottom: 4, fontWeight: "600" },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    backgroundColor: "white",
  },
  status: { marginTop: 20, color: "gray" },
});
