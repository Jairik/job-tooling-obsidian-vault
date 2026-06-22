/* Shared design options used by persisted client settings and visual components. */

/* Lists the animated background choices shown in the settings drawer. */
export const FUN_VARIANTS = [
  { id: "aurora", label: "Aurora" },
  { id: "particles", label: "Particles" },
  { id: "waves", label: "Waves" },
  { id: "dots", label: "Dot Grid" },
  { id: "mesh", label: "Mesh" },
  { id: "matrix", label: "Matrix Rain" },
  { id: "starfield", label: "Starfield" },
  { id: "grid3d", label: "3D Grid" },
  { id: "flicker", label: "Flickering Grid" },
  { id: "comet", label: "Shooting Stars" },
  { id: "balatro", label: "Balatro" },
] as const;

/* Restricts stored background settings to one of the supported identifiers. */
export type FunVariant = (typeof FUN_VARIANTS)[number]["id"];
