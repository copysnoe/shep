import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CompleteWebOnboardingUseCase } from '@/application/use-cases/settings/complete-web-onboarding.use-case.js';
import type { ISettingsRepository } from '@/application/ports/output/repositories/settings.repository.interface.js';
import { createDefaultSettings } from '@/domain/factories/settings-defaults.factory.js';
import { AgentEffort, AgentType, type Settings } from '@/domain/generated/output.js';

/**
 * The Settings page's agent/model picker saves through this use case. It must
 * change only the agent and the default model — every other model setting the
 * user chose (effort, adaptive tiers) has to survive the save.
 */
describe('CompleteWebOnboardingUseCase', () => {
  let stored: Settings;
  let repository: ISettingsRepository;
  let useCase: CompleteWebOnboardingUseCase;

  beforeEach(() => {
    stored = createDefaultSettings();
    repository = {
      initialize: vi.fn(),
      load: vi.fn(async () => stored),
      update: vi.fn(async (s: Settings) => {
        stored = s;
      }),
    };
    useCase = new CompleteWebOnboardingUseCase(repository);
  });

  it('updates the agent and default model and completes onboarding', async () => {
    const result = await useCase.execute({ agentType: AgentType.Cursor, model: ' auto ' });

    expect(result.agent.type).toBe(AgentType.Cursor);
    expect(result.models.default).toBe('auto');
    expect(result.onboardingComplete).toBe(true);
  });

  it('keeps the saved effort and adaptive settings when the model changes', async () => {
    const adaptive = { enabled: true } as NonNullable<Settings['models']['adaptive']>;
    stored.models = { ...stored.models, effort: AgentEffort.high, adaptive };

    const result = await useCase.execute({
      agentType: AgentType.ClaudeCode,
      model: 'claude-sonnet-5',
    });

    expect(result.models).toEqual({
      default: 'claude-sonnet-5',
      effort: AgentEffort.high,
      adaptive,
    });
    expect(stored.models.effort).toBe(AgentEffort.high);
  });

  it('keeps the current default model when none is given', async () => {
    stored.models = { ...stored.models, default: 'claude-opus-5-5', effort: AgentEffort.max };

    const result = await useCase.execute({ agentType: AgentType.ClaudeCode, model: null });

    expect(result.models).toMatchObject({ default: 'claude-opus-5-5', effort: AgentEffort.max });
  });
});
