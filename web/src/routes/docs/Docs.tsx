import { PageSkeleton } from "../../components/States";
import { data } from "../../data";
import { About } from "./About";
import { Decides } from "./Decides";
import { Trust } from "./Trust";

/** The docs group: one chunk for How it decides, How much to trust it and About. */
export function Docs({ page }: { page: string }) {
  if (!data.value) return <PageSkeleton />;
  if (page === "trust") return <Trust />;
  if (page === "about") return <About />;
  return <Decides />;
}
