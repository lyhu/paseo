import { useRef, useSyncExternalStore } from "react";
import { View } from "react-native";
import type { PluginButtonIconProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useStickyMessage } from "./sticky-history";

const disabled = new Set<string>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function toggleSticky(agentId: string) {
  if (disabled.has(agentId)) disabled.delete(agentId);
  else disabled.add(agentId);
  for (const listener of listeners) listener();
}

export function StickyIcon(props: PluginButtonIconProps) {
  const agentId = props.context === "agent" ? props.agentId : "";
  const enabled = useSyncExternalStore(subscribe, () => !disabled.has(agentId));
  const anchor = useRef<View>(null);
  useStickyMessage(anchor, agentId, props.theme, enabled);
  return (
    <View ref={anchor}>
      <Icon
        name={enabled ? "Pin" : "PinOff"}
        size={props.size}
        color={enabled ? props.theme.colors.accent : props.color}
      />
    </View>
  );
}
