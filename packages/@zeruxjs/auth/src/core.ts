import crypto from "node:crypto";

export type AuthDbAdapter = {
    insert(operation: Record<string, unknown>): Promise<Record<string, any>>;
    select(operation: Record<string, unknown>): Promise<Record<string, any>>;
    update(operation: Record<string, unknown>): Promise<Record<string, any>>;
    delete(operation: Record<string, unknown>): Promise<Record<string, any>>;
};

export type AuthConfig = {
    db: {
        usersTable: string;
        rolesTable: string;
        usermetaTable: string;
        fields: {
            userId: string;
            email: string;
            passwordHash: string;
            role: string;
        };
    };
    session: {
        cookieName: string;
        expiresIn: number;
    };
};

let globalConfig: AuthConfig = {
    db: {
        usersTable: "users",
        rolesTable: "groups",
        usermetaTable: "usermeta",
        fields: {
            userId: "id",
            email: "email",
            passwordHash: "password",
            role: "role"
        }
    },
    session: {
        cookieName: "proworkspace_session",
        expiresIn: 86400
    }
};

const keyMaterial = (purpose: string) => {
    const key = process.env.SECURITY_SESSION_KEY || process.env.SECURITY_ENCRYPTION_KEY || "change-me-session-key";
    const salt = process.env.SECURITY_SESSION_SALT || process.env.SECURITY_ENCRYPTION_SALT || "change-me-session-salt";

    if (process.env.NODE_ENV === "production" && (key === "change-me-session-key" || salt === "change-me-session-salt")) {
        throw new Error("Set SECURITY_SESSION_KEY and SECURITY_SESSION_SALT before using sessions in production");
    }
    return crypto.scryptSync(`${key}:${purpose}`, salt, 32);
};

const timingSafeEqualText = (left: string, right: string) => {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);

    return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

export const setAuthConfig = (config: Partial<AuthConfig>) => {
    globalConfig = {
        ...globalConfig,
        ...config,
        db: {
            ...globalConfig.db,
            ...config.db,
            fields: {
                ...globalConfig.db.fields,
                ...config.db?.fields
            }
        },
        session: {
            ...globalConfig.session,
            ...config.session
        }
    };
};

export const getAuthConfig = (): AuthConfig => structuredClone(globalConfig);

/**
 * Title: Password Hash
 * Description: Hashes a password with Node scrypt and a per-password random salt.
 * Global Variables: process.env.SECURITY_PASSWORD_SALT
 * @param password Plain password received from a trusted server-side form handler.
 * @returns Encoded password hash.
 */
export const hashPassword = (password: string) => {
    if (typeof password !== "string" || Buffer.byteLength(password, "utf8") > 4096) throw new Error("Invalid password size");
    const salt = crypto.randomBytes(16).toString("hex");
    const pepper = process.env.SECURITY_PASSWORD_SALT || "change-me-password-salt";
    if (process.env.NODE_ENV === "production" && pepper === "change-me-password-salt") throw new Error("SECURITY_PASSWORD_SALT must be configured in production");
    const hash = crypto.scryptSync(password, `${pepper}:${salt}`, 64).toString("hex");

    return `scrypt:${salt}:${hash}`;
};

export const verifyPassword = (password: string, storedHash: string) => {
    if (typeof password !== "string" || Buffer.byteLength(password, "utf8") > 4096) return false;
    const parts = String(storedHash || "").split(":");
    if (storedHash?.length > 512) return false;
    const pepper = process.env.SECURITY_PASSWORD_SALT || "change-me-password-salt";
    if (process.env.NODE_ENV === "production" && pepper === "change-me-password-salt") throw new Error("SECURITY_PASSWORD_SALT must be configured in production");

    if (parts.length === 3 && parts[0] === "scrypt") {
        const [, salt, hash] = parts;
        if (!/^[a-f0-9]{32}$/i.test(salt) || !/^[a-f0-9]{128}$/i.test(hash)) return false;
        const expectedHash = crypto.scryptSync(password, `${pepper}:${salt}`, 64).toString("hex");
        const legacyExpectedHash = crypto.scryptSync(password, salt, 64).toString("hex");

        return timingSafeEqualText(hash, expectedHash) || timingSafeEqualText(hash, legacyExpectedHash);
    }

    if (parts.length === 2) {
        const [salt, hash] = parts;
        if (!/^[a-f0-9]{32}$/i.test(salt) || !/^[a-f0-9]{128}$/i.test(hash)) return false;
        const expectedHash = crypto.scryptSync(password, `${pepper}${salt}`, 64).toString("hex");

        return timingSafeEqualText(hash, expectedHash);
    }

    return false;
};

export const createSession = (userId: string | number, additionalData: Record<string, unknown> = {}) => {
    if (!Number.isSafeInteger(globalConfig.session.expiresIn) || globalConfig.session.expiresIn < 1 || globalConfig.session.expiresIn > 86400 * 365) throw new RangeError("Invalid session duration");
    const expiresAt = Math.floor(Date.now() / 1000) + globalConfig.session.expiresIn;
    const payload = JSON.stringify({
        ...additionalData,
        userId,
        jti: crypto.randomBytes(16).toString("base64url"),
        expiresAt
    });
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", keyMaterial("session"), iv);
    const encrypted = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();

    return Buffer.concat([iv, tag, encrypted]).toString("base64url");
};

export const verifySession = (token: string) => {
    try {
        if (typeof token !== "string" || token.length > 8192 || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
        const raw = Buffer.from(token, "base64url");
        if (raw.length <= 28) return null;

        const iv = raw.subarray(0, 12);
        const tag = raw.subarray(12, 28);
        const encrypted = raw.subarray(28);
        const decipher = crypto.createDecipheriv("aes-256-gcm", keyMaterial("session"), iv);
        decipher.setAuthTag(tag);
        const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
        const session = JSON.parse(decrypted) as { expiresAt?: number; userId?: string | number };

        if ((typeof session.userId !== "string" && typeof session.userId !== "number") || typeof session.expiresAt !== "number" || !Number.isFinite(session.expiresAt) || Math.floor(Date.now() / 1000) >= session.expiresAt) {
            return null;
        }

        return session;
    } catch {
        return null;
    }
};

export const createUser = async (
    email: string,
    passwordPlain: string,
    role = "employee",
    dbAdapter: AuthDbAdapter,
    extraValues: Record<string, unknown> = {}
) => {
    const config = getAuthConfig();

    return dbAdapter.insert({
        table: config.db.usersTable,
        values: {
            ...extraValues,
            [config.db.fields.email]: email.toLowerCase(),
            [config.db.fields.passwordHash]: hashPassword(passwordPlain),
            [config.db.fields.role]: role
        },
        returning: [config.db.fields.userId]
    });
};

export const verifyUser = async (email: string, passwordPlain: string, dbAdapter: AuthDbAdapter) => {
    const config = getAuthConfig();
    const result = await dbAdapter.select({
        table: config.db.usersTable,
        where: {
            field: config.db.fields.email,
            operator: "eq",
            value: email.toLowerCase()
        },
        limit: 1
    });
    const user = Array.isArray(result.rows) ? result.rows[0] as Record<string, any> | undefined : undefined;

    if (!user || !verifyPassword(passwordPlain, String(user[config.db.fields.passwordHash] || ""))) {
        return false;
    }

    return user;
};

export const getUsermeta = async (userId: string | number, key: string, dbAdapter: AuthDbAdapter) => {
    const config = getAuthConfig();
    const result = await dbAdapter.select({
        table: config.db.usermetaTable,
        where: {
            and: [
                { field: "user_id", operator: "eq", value: userId },
                { field: "key", operator: "eq", value: key }
            ]
        },
        limit: 1
    });
    const row = Array.isArray(result.rows) ? result.rows[0] as { value?: unknown } | undefined : undefined;

    return row?.value ?? null;
};

export const updateUsermeta = async (userId: string | number, key: string, value: unknown, dbAdapter: AuthDbAdapter) => {
    const config = getAuthConfig();
    const existing = await getUsermeta(userId, key, dbAdapter);

    if (existing !== null) {
        return dbAdapter.update({
            table: config.db.usermetaTable,
            values: { value: typeof value === "string" ? value : JSON.stringify(value) },
            where: {
                and: [
                    { field: "user_id", operator: "eq", value: userId },
                    { field: "key", operator: "eq", value: key }
                ]
            }
        });
    }

    return dbAdapter.insert({
        table: config.db.usermetaTable,
        values: {
            user_id: userId,
            key,
            value: typeof value === "string" ? value : JSON.stringify(value)
        }
    });
};

export const getCapabilities = async (role: string, dbAdapter: AuthDbAdapter, orgId?: number) => {
    const config = getAuthConfig();
    const where = orgId
        ? {
            and: [
                { field: "name", operator: "eq", value: role },
                { field: "org_id", operator: "eq", value: orgId }
            ]
        }
        : { field: "name", operator: "eq", value: role };
    const result = await dbAdapter.select({
        table: config.db.rolesTable,
        columns: ["capabilities"],
        where,
        limit: 1
    });
    const row = Array.isArray(result.rows) ? result.rows[0] as { capabilities?: unknown } | undefined : undefined;
    const raw = String(row?.capabilities ?? "");

    if (raw === "*") return ["*"];

    return raw
        .split(/[,\n]+/)
        .map((capability) => capability.trim())
        .filter(Boolean);
};

export const hasCapability = async (
    userRole: string,
    capability: string,
    dbAdapter: AuthDbAdapter,
    orgId?: number
) => {
    const capabilities = await getCapabilities(userRole, dbAdapter, orgId);

    return capabilities.includes("*") || capabilities.includes(capability);
};

export const createPasskeyChallenge = (userId: string, rpId: string, displayName: string) => ({
    challenge: crypto.randomBytes(32).toString("base64url"),
    rp: { name: "ProWorkspace", id: rpId },
    user: { id: Buffer.from(userId).toString("base64url"), name: displayName, displayName },
    pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 }
    ],
    timeout: 60000,
    attestation: "none",
    authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "preferred"
    }
});

export const createOtp = () => crypto.randomInt(100000, 1000000).toString();

export const hashOtp = (otp: string) =>
    crypto.createHmac("sha256", keyMaterial("otp")).update(otp).digest("hex");

export const verifyOtp = (otp: string, hash: string) =>
    timingSafeEqualText(hashOtp(otp), hash);
