import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  Button,
  ScrollView,
  StyleSheet,
} from "react-native";

const API_URL = "https://eir-backend-493785333909.us-central1.run.app"; // e.g. https://eir-backend-xxxxx-uc.a.run.app

type SymptomEntry = {
  id: string;
  date: string;
  symptoms: {
    hotFlashes?: number;
    nightSweats?: number;
    sleepQuality?: number;
    mood?: number;
  };
  notes?: string;
};

export default function HomeScreen() {
  const [date, setDate] = useState(
    () => new Date().toISOString().slice(0, 10) // YYYY-MM-DD
  );
  const [hotFlashes, setHotFlashes] = useState("0");
  const [nightSweats, setNightSweats] = useState("0");
  const [sleepQuality, setSleepQuality] = useState("5");
  const [mood, setMood] = useState("5");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState("");
  const [history, setHistory] = useState<SymptomEntry[] | any>([]);

  const loadHistory = async () => {
    try {
      const res = await fetch(`${API_URL}/symptoms`);
      const data = await res.json();
      console.log("History response:", data);

      if (Array.isArray(data)) {
        setHistory(data);
      } else {
        // If backend returned an error object, avoid crashing UI
        setHistory([]);
      }
    } catch (e) {
      console.log("Error loading history", e);
      setHistory([]);
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);

  const saveToday = async () => {
    try {
      setStatus("Saving...");

      const body = {
        date,
        symptoms: {
          hotFlashes: Number(hotFlashes),
          nightSweats: Number(nightSweats),
          sleepQuality: Number(sleepQuality),
          mood: Number(mood),
        },
        notes,
      };

      const res = await fetch(`${API_URL}/symptoms/today`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text);
      }

      setStatus("Saved!");
      setNotes("");
      await loadHistory();
    } catch (e: any) {
      console.log("Save error:", e);
      setStatus("Error saving: " + e.message);
    }
  };

  const isHistoryArray = Array.isArray(history);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Eirvana – Today&apos;s Symptoms</Text>

      <Text style={styles.label}>Date (YYYY-MM-DD)</Text>
      <TextInput
        value={date}
        onChangeText={setDate}
        style={styles.input}
      />

      <Text style={styles.label}>Hot flashes (0–10)</Text>
      <TextInput
        value={hotFlashes}
        onChangeText={setHotFlashes}
        keyboardType="numeric"
        style={styles.input}
      />

      <Text style={styles.label}>Night sweats (0–10)</Text>
      <TextInput
        value={nightSweats}
        onChangeText={setNightSweats}
        keyboardType="numeric"
        style={styles.input}
      />

      <Text style={styles.label}>Sleep quality (0–10)</Text>
      <TextInput
        value={sleepQuality}
        onChangeText={setSleepQuality}
        keyboardType="numeric"
        style={styles.input}
      />

      <Text style={styles.label}>Mood (0–10)</Text>
      <TextInput
        value={mood}
        onChangeText={setMood}
        keyboardType="numeric"
        style={styles.input}
      />

      <Text style={styles.label}>Notes</Text>
      <TextInput
        value={notes}
        onChangeText={setNotes}
        multiline
        style={[styles.input, styles.notesInput]}
        placeholder="Anything you want to remember about today?"
      />

      <View style={styles.buttonWrapper}>
        <Button title="Save today’s log" onPress={saveToday} />
      </View>

      {status ? <Text style={styles.status}>{status}</Text> : null}

      <Text style={styles.subtitle}>Recent entries</Text>

      {isHistoryArray && history.length === 0 && (
        <Text>No entries yet.</Text>
      )}

      {isHistoryArray &&
        history.map((entry: SymptomEntry) => (
          <View key={entry.id} style={styles.card}>
            <Text style={styles.cardDate}>{entry.date}</Text>
            <Text>
              Hot flashes: {entry.symptoms.hotFlashes ?? "-"} | Night sweats:{" "}
              {entry.symptoms.nightSweats ?? "-"}
            </Text>
            <Text>
              Sleep: {entry.symptoms.sleepQuality ?? "-"} | Mood:{" "}
              {entry.symptoms.mood ?? "-"}
            </Text>
            {entry.notes ? (
              <Text style={styles.cardNotes}>Notes: {entry.notes}</Text>
            ) : null}
          </View>
        ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    paddingBottom: 40,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 20,
    fontWeight: "600",
    marginTop: 24,
    marginBottom: 8,
  },
  label: {
    marginBottom: 4,
    marginTop: 8,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 8,
    marginBottom: 8,
  },
  notesInput: {
    minHeight: 60,
  },
  buttonWrapper: {
    marginTop: 8,
  },
  status: {
    marginTop: 8,
    color: "gray",
  },
  card: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  cardDate: {
    fontWeight: "600",
    marginBottom: 4,
  },
  cardNotes: {
    marginTop: 4,
  },
});