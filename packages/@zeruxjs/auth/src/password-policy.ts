export interface PasswordPolicy { minLength?: number; maxLength?: number; requireUppercase?: boolean; requireLowercase?: boolean; requireDigit?: boolean; requireSymbol?: boolean; }
export interface PasswordAssessment { valid: boolean; issues: string[]; }
export function validatePasswordStrength(value: string, policy: PasswordPolicy = {}): PasswordAssessment {
    const issues: string[] = [];
    const min = policy.minLength ?? 12, max = policy.maxLength ?? 256;
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min < 8 || max < min || max > 4096) throw new RangeError("Invalid password policy");
    if (typeof value !== "string") return { valid: false, issues: ["Password must be a string"] };
    const length = Array.from(value).length;
    if (length < min) issues.push(`Must contain at least ${min} characters`);
    if (length > max) issues.push(`Must contain no more than ${max} characters`);
    if (/\p{Cc}/u.test(value)) issues.push("Control characters are not allowed");
    if ((policy.requireUppercase ?? false) && !/\p{Lu}/u.test(value)) issues.push("An uppercase letter is required");
    if ((policy.requireLowercase ?? false) && !/\p{Ll}/u.test(value)) issues.push("A lowercase letter is required");
    if ((policy.requireDigit ?? false) && !/\p{Nd}/u.test(value)) issues.push("A digit is required");
    if ((policy.requireSymbol ?? false) && !/[^\p{L}\p{N}\s]/u.test(value)) issues.push("A symbol is required");
    return { valid: issues.length === 0, issues };
}
