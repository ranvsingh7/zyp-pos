/**
 * Read-only rendering of a set of service keys.
 *
 * Shared by the Super Admin plan/subscription views and the restaurant's own
 * subscription page so "what my plan includes" looks and reads the same in
 * both places, and so the labels can only ever come from the catalog.
 *
 * Presentational only: it renders whatever keys it is handed and never decides
 * what a venue is entitled to. That decision belongs to the server
 * (`resolveEntitledServices`), not to a component.
 */
import { Badge } from "@/components/ui/badge";
import { getService, isServiceKey, type ServiceKey } from "@/lib/services/catalog";

export function ServiceKeyList({
  serviceKeys,
  emptyLabel = "No services included.",
  showDescriptions = false,
}: {
  serviceKeys: readonly unknown[];
  emptyLabel?: string;
  showDescriptions?: boolean;
}) {
  const keys = serviceKeys.filter(isServiceKey);
  if (keys.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  }
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {keys.map((key) => (
        <ServiceKeyRow key={key} serviceKey={key} showDescription={showDescriptions} />
      ))}
    </ul>
  );
}

function ServiceKeyRow({
  serviceKey,
  showDescription,
}: {
  serviceKey: ServiceKey;
  showDescription: boolean;
}) {
  const definition = getService(serviceKey);
  return (
    <li className="flex items-start gap-2">
      <Badge variant="secondary" className="shrink-0">
        {definition.name}
      </Badge>
      {showDescription && definition.description ? (
        <span className="text-sm text-muted-foreground">{definition.description}</span>
      ) : null}
    </li>
  );
}
