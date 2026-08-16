import { useEffect, useState } from "react";
import { openRouteOfferForm, type RouteOfferFormSnapshot } from "./route-offer-form-model";

export function useRouteOfferFormModel(snapshot: RouteOfferFormSnapshot) {
  const [model] = useState(() => openRouteOfferForm(snapshot));

  useEffect(() => () => model.close(), [model]);

  return model;
}
