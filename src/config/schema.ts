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
    downtimeLookbackHoursMax: PositiveNumber,
    exits: z.object({
      tpEnabled: z.boolean().default(true),
      deltaEnabled: z.boolean().default(true),
      liqEnabled: z.boolean().default(true),
      timeEnabled: z.boolean().default(false)
    })
  }),
  costs: z.object({
    useFees: z.boolean(),
    useSlippage: z.boolean(),
    takerFeeBps: NonNegativeNumber,
    entrySlippageBps: NonNegativeNumber,
    exitSlippageBps: NonNegativeNumber,
    dynamicSlippage: z.object({
      enabled: z.boolean().default(false),
      minBps: NonNegativeNumber.default(3),
      maxBps: NonNegativeNumber.default(30),
      volumeReferenceUsd: PositiveNumber.default(1_000_000),
      volumeExponent: PositiveNumber.default(0.5),
      spreadMultiplier: NonNegativeNumber.default(2),
      entryBiasBps: z.number().finite().default(0),
      exitBiasBps: z.number().finite().default(0)
    }),
    tpFromRealizedEntry: z.object({
      enabled: z.boolean().default(true),
      includeEntryFee: z.boolean().default(true),
      includeEntrySlippage: z.boolean().default(true)
    })
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
    exits: {
      tpEnabled: boolean;
      deltaEnabled: boolean;
      liqEnabled: boolean;
      timeEnabled: boolean;
    };
  };
  costs: {
    useFees: boolean;
    useSlippage: boolean;
    takerFeeBps: number;
    entrySlippageBps: number;
    exitSlippageBps: number;
    dynamicSlippage: {
      enabled: boolean;
      minBps: number;
      maxBps: number;
      volumeReferenceUsd: number;
      volumeExponent: number;
      spreadMultiplier: number;
      entryBiasBps: number;
      exitBiasBps: number;
    };
    tpFromRealizedEntry: {
      enabled: boolean;
      includeEntryFee: boolean;
      includeEntrySlippage: boolean;
    };
  };
  funding: {
    enabled: boolean;
    shortReceivesWhenPositive: boolean;
  };
}
