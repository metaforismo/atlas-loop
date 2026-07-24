export interface LocalLaunchProfile {
  id: string;
  label: string;
  detail: string;
  bundleId: string;
  arguments: string[];
  environment: Record<string, string>;
  createdAt?: string;
  updatedAt?: string;
}

export interface LocalLaunchProfileDraft {
  label: string;
  detail: string;
  bundleId: string;
  argumentsSource: string;
  environmentSource: string;
}

export interface LaunchProfileValidationError {
  field: "label" | "detail" | "bundleId" | "arguments" | "environment";
  message: string;
  line?: number;
}

export interface CompiledLaunchProfile {
  arguments: string[];
  environment: Record<string, string>;
  errors: LaunchProfileValidationError[];
}

export const MAX_LAUNCH_ARGUMENTS = 32;
export const MAX_LAUNCH_ENVIRONMENT_VALUES = 32;
const MAX_SOURCE_LENGTH = 8_000;
const MAX_ARGUMENT_LENGTH = 512;
const MAX_ENVIRONMENT_VALUE_LENGTH = 1_024;
const BUNDLE_ID_PATTERN = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
const ENVIRONMENT_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const SENSITIVE_ENVIRONMENT_KEY_PATTERN = /(?:^|_)(?:AUTH|TOKEN|SECRET|PASSWORD|PASSCODE|API_?KEY|PRIVATE_?KEY)(?:_|$)/i;

export const LOCAL_LAUNCH_PROFILE_STARTERS: LocalLaunchProfile[] = [
  createStarter(
    "gesture-lab",
    "Gesture Lab",
    "Open the bundled native canvas directly for pinch, rotate, two-finger tap, and edge-gesture checks.",
    [],
    { ATLAS_LOOP_DEMO_ROUTE: "gesture-lab" }
  ),
  createStarter(
    "checkout-confirmation",
    "Checkout confirmation",
    "Launch the bundled Commerce Demo at its stable confirmation fixture for visual and evidence checks.",
    [],
    { ATLAS_LOOP_DEMO_ROUTE: "confirmation" }
  ),
  createStarter(
    "payment-review",
    "Payment review",
    "Exercise launch arguments by opening the deterministic payment-review fixture before a test starts.",
    ["--atlas-demo-route=payment-review"],
    {}
  )
];

export function compileLaunchProfileDraft(draft: LocalLaunchProfileDraft): CompiledLaunchProfile {
  const errors: LaunchProfileValidationError[] = [];
  const label = draft.label.trim();
  const detail = draft.detail.trim();
  const bundleId = draft.bundleId.trim();

  if (!label) errors.push({ field: "label", message: "Give this launch profile a name." });
  else if (label.length > 80) errors.push({ field: "label", message: "Keep the profile name under 80 characters." });
  if (detail.length > 240) errors.push({ field: "detail", message: "Keep the description under 240 characters." });
  if (!bundleId) errors.push({ field: "bundleId", message: "Add the installed app bundle ID." });
  else if (bundleId.length > 255 || !BUNDLE_ID_PATTERN.test(bundleId)) {
    errors.push({ field: "bundleId", message: "Use a valid bundle ID such as app.example.YourApp." });
  }

  const args = parseArgumentLines(draft.argumentsSource, errors);
  const environment = parseEnvironmentLines(draft.environmentSource, errors);
  return { arguments: args, environment, errors };
}

export function launchProfileToDraft(profile: LocalLaunchProfile): LocalLaunchProfileDraft {
  return {
    label: profile.label,
    detail: profile.detail,
    bundleId: profile.bundleId,
    argumentsSource: profile.arguments.join("\n"),
    environmentSource: Object.entries(profile.environment).map(([key, value]) => `${key}=${value}`).join("\n")
  };
}

export function launchProfileHasSensitiveEnvironmentKey(profile: Pick<LocalLaunchProfile, "environment">): boolean {
  return Object.keys(profile.environment).some((key) => SENSITIVE_ENVIRONMENT_KEY_PATTERN.test(key));
}

function parseArgumentLines(source: string, errors: LaunchProfileValidationError[]): string[] {
  if (source.length > MAX_SOURCE_LENGTH) {
    errors.push({ field: "arguments", message: "Keep launch arguments under 8,000 characters." });
    return [];
  }
  const values: string[] = [];
  for (const [index, rawLine] of source.split(/\r?\n/).entries()) {
    const value = rawLine.trim();
    if (!value || value.startsWith("#")) continue;
    if (values.length >= MAX_LAUNCH_ARGUMENTS) {
      errors.push({ field: "arguments", line: index + 1, message: `Use at most ${MAX_LAUNCH_ARGUMENTS} launch arguments.` });
      break;
    }
    if (value.length > MAX_ARGUMENT_LENGTH) {
      errors.push({ field: "arguments", line: index + 1, message: `Keep each launch argument under ${MAX_ARGUMENT_LENGTH} characters.` });
      continue;
    }
    if (/\0/.test(value)) {
      errors.push({ field: "arguments", line: index + 1, message: "Launch arguments cannot contain null characters." });
      continue;
    }
    values.push(value);
  }
  return values;
}

function parseEnvironmentLines(source: string, errors: LaunchProfileValidationError[]): Record<string, string> {
  if (source.length > MAX_SOURCE_LENGTH) {
    errors.push({ field: "environment", message: "Keep environment values under 8,000 characters." });
    return {};
  }
  const values: Record<string, string> = {};
  for (const [index, rawLine] of source.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (Object.keys(values).length >= MAX_LAUNCH_ENVIRONMENT_VALUES) {
      errors.push({ field: "environment", line: index + 1, message: `Use at most ${MAX_LAUNCH_ENVIRONMENT_VALUES} environment values.` });
      break;
    }
    const separator = line.indexOf("=");
    if (separator < 1) {
      errors.push({ field: "environment", line: index + 1, message: "Use KEY=VALUE format." });
      continue;
    }
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!ENVIRONMENT_KEY_PATTERN.test(key)) {
      errors.push({ field: "environment", line: index + 1, message: "Environment keys may contain letters, numbers, and underscores." });
      continue;
    }
    if (["__proto__", "prototype", "constructor"].includes(key.toLowerCase())) {
      errors.push({ field: "environment", line: index + 1, message: `${key} is reserved and cannot be used as an environment key.` });
      continue;
    }
    if (SENSITIVE_ENVIRONMENT_KEY_PATTERN.test(key)) {
      errors.push({ field: "environment", line: index + 1, message: `${key} looks sensitive. Pass secrets through your shell instead of browser storage.` });
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      errors.push({ field: "environment", line: index + 1, message: `${key} is defined more than once.` });
      continue;
    }
    if (value.length > MAX_ENVIRONMENT_VALUE_LENGTH) {
      errors.push({ field: "environment", line: index + 1, message: `Keep each environment value under ${MAX_ENVIRONMENT_VALUE_LENGTH} characters.` });
      continue;
    }
    if (/\0/.test(value)) {
      errors.push({ field: "environment", line: index + 1, message: "Environment values cannot contain null characters." });
      continue;
    }
    values[key] = value;
  }
  return values;
}

function createStarter(id: string, label: string, detail: string, args: string[], environment: Record<string, string>): LocalLaunchProfile {
  return {
    id,
    label,
    detail,
    bundleId: "app.atlasloop.CommerceDemo",
    arguments: args,
    environment
  };
}
