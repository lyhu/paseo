import { useEffect, useState } from "react";
import { openAccessTokenForm, type AccessTokenFormSnapshot } from "./access-token-form-model";

export function useAccessTokenFormModel(snapshot: AccessTokenFormSnapshot) {
  const [model] = useState(() => openAccessTokenForm(snapshot));

  useEffect(() => () => model.close(), [model]);

  return model;
}
