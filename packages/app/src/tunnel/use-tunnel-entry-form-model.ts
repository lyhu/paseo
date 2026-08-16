import { useEffect, useState } from "react";
import { openTunnelEntryForm, type TunnelEntryFormSnapshot } from "./tunnel-entry-form-model";

export function useTunnelEntryFormModel(snapshot: TunnelEntryFormSnapshot) {
  const [model] = useState(() => openTunnelEntryForm(snapshot));

  useEffect(() => () => model.close(), [model]);

  return model;
}
