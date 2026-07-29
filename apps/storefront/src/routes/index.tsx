import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: HomeComponent,
});

function HomeComponent() {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-8">
      <h1 className="font-medium text-2xl">mze-store</h1>
    </div>
  );
}
