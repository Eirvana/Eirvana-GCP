import React, { useState } from "react";
import { View, Text, TextInput, Button, StyleSheet } from "react-native";
import { useRouter } from "expo-router";

export default function LoginScreen() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");

  const onSubmit = () => {
    const userId = email.trim().toLowerCase();
    if (!userId) return;

    router.push({
      pathname: "/connect-devices",
      params: { userId, name },
    });
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Eirvana</Text>
      <Text style={styles.subtitle}>
        {mode === "signup" ? "Create your account" : "Welcome back"}
      </Text>

      {mode === "signup" && (
        <>
          <Text style={styles.label}>Name</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
          />
        </>
      )}

      <Text style={styles.label}>Email</Text>
      <TextInput
        style={styles.input}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
      />

      <Text style={styles.label}>Password</Text>
      <TextInput
        style={styles.input}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />

      <Button title={mode} onPress={onSubmit} />

      <Text
        style={styles.switch}
        onPress={() => setMode(mode === "signup" ? "login" : "signup")}
      >
        {mode === "signup"
          ? "Already have an account? Log in"
          : "New here? Sign up"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, justifyContent: "center" },
  title: { fontSize: 32, fontWeight: "700" },
  subtitle: { fontSize: 18, marginBottom: 20 },
  label: { marginTop: 12 },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginTop: 4,
  },
  switch: { marginTop: 16, color: "blue" },
});
