import { useEffect, useState } from "react";
import { openEgressForm, type EgressFormSnapshot } from "./egress-form-model";

export function useEgressFormModel(snapshot: EgressFormSnapshot) {
  const [model] = useState(() => openEgressForm(snapshot));

  useEffect(() => () => model.close(), [model]);

  return model;
}
