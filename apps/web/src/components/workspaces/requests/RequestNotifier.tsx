import type { EnvironmentId, PeerHubStatus } from "@t3tools/contracts";
import { useCallback, useEffect, useRef } from "react";
import { getClientSettings, useClientSettings } from "../../../hooks/useSettings";
import {
  hasDesktopNotifications,
  hasNotificationSound,
  playNotificationSound,
} from "../../../threadNotifications";
import { toastManager } from "../../ui/toast";
import { useSidebarView } from "../SidebarViewSwitch";
import { usePeerHubStatus } from "../WorkspaceAccess";
import {
  makeRequestObserver,
  batchNotice,
  requestKey,
  stillPending,
  noticeEnabled,
  type RequestNoticeRow,
} from "./notify.logic";
export function RequestNotifier({
  environmentIds,
}: {
  readonly environmentIds: ReadonlyArray<EnvironmentId>;
}) {
  const mode = useClientSettings((settings) => settings.notificationMode),
    inApp = useClientSettings((settings) => settings.inAppNotificationsEnabled);
  const [, setSidebarView] = useSidebarView();
  const observer = useRef(makeRequestObserver()),
    statuses = useRef(new Map<EnvironmentId, PeerHubStatus | null>());
  const alerts = useRef(
    new Map<
      string,
      { rows: ReadonlyArray<RequestNoticeRow>; notification?: Notification; toast?: string }
    >(),
  );
  const close = useCallback((key: string) => {
    const alert = alerts.current.get(key);
    if (alert === undefined) return;
    alert.notification?.close();
    if (alert.toast !== undefined) toastManager.close(alert.toast);
    alerts.current.delete(key);
  }, []);
  useEffect(
    () => () => {
      for (const key of alerts.current.keys()) close(key);
    },
    [close],
  );
  useEffect(() => {
    for (const [key, alert] of alerts.current) {
      let notification = alert.notification;
      let toast = alert.toast;
      if (!hasDesktopNotifications(mode)) {
        notification?.close();
        notification = undefined;
      }
      if (!inApp && toast !== undefined) {
        toastManager.close(toast);
        toast = undefined;
      }
      if (notification === undefined && toast === undefined) alerts.current.delete(key);
      else
        alerts.current.set(key, {
          rows: alert.rows,
          ...(notification === undefined ? {} : { notification }),
          ...(toast === undefined ? {} : { toast }),
        });
    }
  }, [mode, inApp]);
  const observe = useCallback(
    (environment: EnvironmentId, status: PeerHubStatus | null) => {
      statuses.current.set(environment, status);
      for (const [key, alert] of alerts.current)
        if (stillPending(alert.rows, [...statuses.current.values()]).length === 0) close(key);
      const arrived = observer.current.observe(environment, status);
      if (arrived.length === 0 || !noticeEnabled(mode, inApp)) return;
      const text = batchNotice(arrived),
        key = requestKey(arrived[0]!);
      const focus = () => {
        close(key);
        window.focus();
        setSidebarView("work");
      };
      const focused = document.visibilityState === "visible" && document.hasFocus();
      if (hasNotificationSound(mode))
        void playNotificationSound("input", () =>
          hasNotificationSound(getClientSettings().notificationMode),
        );
      if (inApp && focused) {
        const toast = toastManager.add({
          type: "warning",
          title: text.title,
          description: text.body,
          data: { hideCopyButton: true },
          actionProps: { children: "Open Needs you", onClick: focus },
        });
        alerts.current.set(key, { rows: arrived, toast });
      } else if (
        !focused &&
        hasDesktopNotifications(mode) &&
        typeof Notification !== "undefined" &&
        Notification.permission === "granted"
      ) {
        try {
          const notification = new Notification(text.title, {
            body: text.body,
            tag: `peer-request:${key}`,
            silent: true,
          });
          notification.addEventListener("click", focus);
          alerts.current.set(key, { rows: arrived, notification });
        } catch {
          /* The browser may expose the API without permitting alerts. */
        }
      }
    },
    [mode, inApp, setSidebarView, close],
  );
  return environmentIds.map((environmentId) => (
    <RequestEnvironment key={environmentId} environmentId={environmentId} observe={observe} />
  ));
}
function RequestEnvironment({
  environmentId,
  observe,
}: {
  readonly environmentId: EnvironmentId;
  readonly observe: (environment: EnvironmentId, status: PeerHubStatus | null) => void;
}) {
  const status = usePeerHubStatus(environmentId);
  const latest = useRef(observe);
  useEffect(() => {
    latest.current = observe;
  }, [observe]);
  useEffect(() => {
    observe(environmentId, status);
  }, [environmentId, status, observe]);
  useEffect(() => () => latest.current(environmentId, null), [environmentId]);
  return null;
}
