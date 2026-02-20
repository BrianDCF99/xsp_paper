import { z } from "zod";

const PositiveNumber = z.number().finite().positive();
const NonNegativeNumber = z.number().finite().min(0);

export const FileConfigSchema = z.object({
  app: z.object({
    version: z.string().min(1),
    scanIntervalMs: PositiveNumber,
    symbolRefreshIntervalMs: PositiveNumber
  }),
  bybit: z.object({
    baseUrl: z.string().url(),
    category: z.literal("linear"),
    timeoutMs: PositiveNumber,
    symbolBatchSize: PositiveNumber,
    maxSymbols: PositiveNumber,
    requestPauseMs: NonNegativeNumber
  }),
  telegram: z.object({
    enabled: z.boolean(),
    parseMode: z.string().default("HTML"),
    commandPollMs: PositiveNumber
  }),
  strategy: z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    sellRatioMax: PositiveNumber,
    minHourVolume: PositiveNumber,
    leverage: PositiveNumber,
    takeProfitPct: PositiveNumber,
    deltaExitThreshold: PositiveNumber,
    maxHoldHours: NonNegativeNumber,
    maxOpenPositions: PositiveNumber,
    preventDuplicateSymbols: z.boolean(),
    replaceThresholdPct: PositiveNumber,
    replaceThresholdBasis: z.enum(["unlevered", "levered"]),
    startingEquityUsd: PositiveNumber,
    entryMarginFraction: PositiveNumber,
    entryMarginCapUsd: PositiveNumber,
    minActiveCashUsd: PositiveNumber,
    reconcileDowntimeExits: z.boolean(),
    downtimeLookbackHoursMax: PositiveNumber
  }),
  costs: z.object({
    useFees: z.boolean(),
    useSlippage: z.boolean(),
    takerFeeBps: NonNegativeNumber,
    entrySlippageBps: NonNegativeNumber,
    exitSlippageBps: NonNegativeNumber
  }),
  funding: z.object({
    enabled: z.boolean(),
    shortReceivesWhenPositive: z.boolean()
  })
});

export const SecretEnvSchema = z.object({
  NODE_ENV: z.string().optional(),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_SCHEMA: z.string().optional().default("public"),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional()
});

export interface AppConfig {
  app: {
    env: string;
    version: string;
    scanIntervalMs: number;
    symbolRefreshIntervalMs: number;
  };
  supabase: {
    url: string;
    serviceRoleKey: string;
    schema: string;
  };
  bybit: {
    baseUrl: string;
    category: "linear";
    timeoutMs: number;
    symbolBatchSize: number;
    maxSymbols: number;
    requestPauseMs: number;
  };
  telegram: {
    enabled: boolean;
    botToken: string;
    chatId: string;
    parseMode: string;
    commandPollMs: number;
  };
  strategy: {
    id: string;
    title: string;
    sellRatioMax: number;
    minHourVolume: number;
    leverage: number;
    takeProfitPct: number;
    deltaExitThreshold: number;
    maxHoldHours: number;
    maxOpenPositions: number;
    preventDuplicateSymbols: boolean;
    replaceThresholdPct: number;
    replaceThresholdBasis: "unlevered" | "levered";
    startingEquityUsd: number;
    entryMarginFraction: number;
    entryMarginCapUsd: number;
    minActiveCashUsd: number;
    reconcileDowntimeExits: boolean;
    downtimeLookbackHoursMax: number;
  };
  costs: {
    useFees: boolean;
    useSlippage: boolean;
    takerFeeBps: number;
    entrySlippageBps: number;
    exitSlippageBps: number;
  };
  funding: {
    enabled: boolean;
    shortReceivesWhenPositive: boolean;
  };
}
