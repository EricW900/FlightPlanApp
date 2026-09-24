import AeroRoute from "@/AeroRoute";

import * as Clipboard from "expo-clipboard";

import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

// Copiar o plano de voo.
async function copyRoute(text: string): Promise<boolean> {
  return Clipboard.setStringAsync(text);
}

export default function Index() {
  const [isActive, setIsActive] = useState(
    AppState.currentState !== "background"
  );

  useEffect(() => {
    const subscription = AppState.addEventListener(
      "change",
      (state) => {
        setIsActive(state === "active");
      }
    );

    return () => subscription.remove();
  }, []);

  return (
    <SafeAreaView
      style={{
        flex: 1,
        backgroundColor: "#080e1c",
      }}
    >
      <StatusBar style="light" />

      <AeroRoute
        isActive={isActive}
        onCopyRoute={copyRoute}
        dom={{
          style: { flex: 1 },
          scrollEnabled: false,
          contentInsetAdjustmentBehavior: "never",
        }}
      />
    </SafeAreaView>
  );
}