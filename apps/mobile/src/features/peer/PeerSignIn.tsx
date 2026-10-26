import type { EnvironmentId, PeerHubStatus } from "@t3tools/contracts";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useState } from "react";
import { Pressable, TextInput, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsSection } from "../settings/components/SettingsSection";
import { looksLikeEmail, signInCode } from "./peerSignIn.logic";

/**
 * Signs the connected environment in to its Peer Hub, as web and desktop do: the Hub mails a
 * 6-digit code to the work email and the code signs the environment in. Organizations founded for
 * the person and invitations show below once it is. A company's own Hub address is set on web or
 * desktop; this uses the one the environment already has.
 */
export function PeerSignIn({
  environmentId,
  status,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
}) {
  const startSignIn = useAtomCommand(serverEnvironment.peerHubStartSignIn, {
    reportFailure: false,
  });
  const finishSignIn = useAtomCommand(serverEnvironment.peerHubFinishSignIn, {
    reportFailure: false,
  });
  const cancel = useAtomCommand(serverEnvironment.peerHubSignOut, { reportFailure: false });
  const [email, setEmail] = useState(status.pendingSignIn?.email ?? "");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = status.pendingSignIn;

  const run = (action: () => Promise<AtomCommandResult<unknown, unknown>>) => {
    setBusy(true);
    setError(null);
    void action()
      .then((result) => {
        if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
          const cause = squashAtomCommandFailure(result);
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      })
      .finally(() => setBusy(false));
  };
  const sendCode = () => {
    if (busy || !looksLikeEmail(email)) return;
    run(() => startSignIn({ environmentId, input: { email: email.trim() } }));
  };
  const submitCode = () => {
    if (busy || code.length !== 6) return;
    run(() => finishSignIn({ environmentId, input: { code } }));
  };
  const sentTo = (pending?.email || email).trim();

  return (
    <SettingsSection title="Peer Hub">
      <View className="gap-3 p-4">
        {pending === null ? (
          <>
            <Text className="text-foreground-muted">
              Sign in with your work email to see your organizations, the invitations waiting for
              you and the projects your team shares. Peer works on this computer without it.
            </Text>
            <TextInput
              accessibilityLabel="Your work email"
              autoCapitalize="none"
              autoComplete="email"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              returnKeyType="send"
              editable={!busy}
              value={email}
              onChangeText={setEmail}
              onSubmitEditing={sendCode}
              placeholder="you@company.com"
              className="rounded-lg border border-border p-3 text-foreground"
            />
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: busy || !looksLikeEmail(email) }}
              disabled={busy || !looksLikeEmail(email)}
              onPress={sendCode}
            >
              <Text className={looksLikeEmail(email) ? "text-primary" : "text-foreground-muted"}>
                {busy ? "Sending…" : "Email me a code"}
              </Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text className="text-foreground-muted">
              {sentTo === ""
                ? "Enter the 6-digit code we emailed you."
                : `Enter the 6-digit code we emailed to ${sentTo}.`}
            </Text>
            <TextInput
              accessibilityLabel="Sign-in code"
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              keyboardType="number-pad"
              returnKeyType="done"
              editable={!busy}
              value={code}
              onChangeText={(value) => setCode(signInCode(value))}
              onSubmitEditing={submitCode}
              placeholder="123456"
              className="rounded-lg border border-border p-3 text-foreground"
            />
            {pending.echoedCode ? (
              <Text className="text-sm text-foreground-muted">
                Development hub: the code is {pending.echoedCode}.
              </Text>
            ) : null}
            <View className="flex-row flex-wrap gap-4">
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: busy || code.length !== 6 }}
                disabled={busy || code.length !== 6}
                onPress={submitCode}
              >
                <Text className={code.length === 6 ? "text-primary" : "text-foreground-muted"}>
                  {busy ? "Signing in…" : "Sign in"}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: busy }}
                disabled={busy}
                onPress={() => {
                  setCode("");
                  run(() => startSignIn({ environmentId, input: { email: pending.email } }));
                }}
              >
                <Text className="text-foreground-muted">Send a new code</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: busy }}
                disabled={busy}
                onPress={() => {
                  setCode("");
                  run(() => cancel({ environmentId, input: {} }));
                }}
              >
                <Text className="text-foreground-muted">Use a different address</Text>
              </Pressable>
            </View>
          </>
        )}
        {error === null ? null : (
          <Text accessibilityRole="alert" className="text-destructive">
            {error}
          </Text>
        )}
      </View>
    </SettingsSection>
  );
}
