export interface BuildGasCitySlingFormulaCommandArgs {
  target: string;
  formula: string;
  vars?: Record<string, string>;
}

export function buildGasCitySlingFormulaCommand(
  args: BuildGasCitySlingFormulaCommandArgs,
): string[] {
  const target = args.target.trim();
  const formula = args.formula.trim();
  if (!target) {
    throw new Error("Choose a sling target before dispatching.");
  }
  if (!formula) {
    throw new Error("Choose a formula before dispatching.");
  }
  const command = ["sling", target, formula, "--formula"];
  for (const [key, value] of Object.entries(args.vars ?? {}).sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    const trimmedKey = key.trim();
    if (!trimmedKey) continue;
    command.push("--var", `${trimmedKey}=${value}`);
  }
  return command;
}
