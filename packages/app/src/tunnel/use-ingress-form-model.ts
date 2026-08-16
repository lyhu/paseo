import { useEffect, useState } from "react";
import { openIngressForm, type IngressFormSnapshot } from "./ingress-form-model";

export function useIngressFormModel(snapshot: IngressFormSnapshot) {
  const [model] = useState(() => openIngressForm(snapshot));

  useEffect(() => () => model.close(), [model]);

  return model;
}
