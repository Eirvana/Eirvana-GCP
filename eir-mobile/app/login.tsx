
import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Button,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";

import { auth } from "../firebase"; // ensure this file exists and exports `auth`
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
} from "firebase/auth";

export default function LoginScreen() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async () => {
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || !password) {
      Alert.alert("Error", "Email and password are required.");
      return;
    }

    setLoading(true);
    try {
      if (mode === "signup") {
        // Create account
        const userCredential = await createUserWithEmailAndPassword(
          auth,
          trimmedEmail,
          password
        );

        // Optionally set displayName
        if (name && auth.currentUser) {
          await updateProfile(auth.currentUser, { displayName: name });
        }

        const uid = userCredential.user.uid;
        const displayName = auth.currentUser?.displayName || name || "";

        // Navigate to connect-devices with the real uid
        router.replace({
          pathname: "/connect-devices",
          params: { userId: uid, name: displayName },
        });
      } else {
        // Login
        const userCredential = await signInWithEmailAndPassword(
          auth,
          trimmedEmail,
          password
        );
        const uid = userCredential.user.uid;
        const displayName = userCredential.user.displayName || "";

        router.replace({
          pathname: "/connect-devices",
          params: { userId: uid, name: displayName },
        });
      }
    } catch (e: any) {
      console.error("Auth error", e);
      Alert.alert("Authentication failed", e.message || String(e));
    } finally {
      setLoading(false);
    }
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
          <TextInput style={styles.input} value={name} onChangeText={setName} />
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

      {loading ? (
        <ActivityIndicator style={{ marginTop: 12 }} />
      ) : (
        <Button title={mode === "signup" ? "Sign up" : "Sign in"} onPress={onSubmit} />
      )}

      <Text
        style={styles.switch}
        onPress={() => setMode(mode === "signup" ? "login" : "signup")}
      >
        {mode === "signup" ? "Already have an account? Log in" : "New here? Sign up"}
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