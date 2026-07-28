import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { SpansService } from './spans.service';
import { TracesService } from './traces.service';

describe('SpansService', () => {
  let spansService: SpansService;
  let prisma: {
    span: { create: jest.Mock; upsert: jest.Mock; findUnique: jest.Mock };
  };
  let tracesService: { findOwnedTrace: jest.Mock };

  beforeEach(async () => {
    prisma = {
      span: { create: jest.fn(), upsert: jest.fn(), findUnique: jest.fn() },
    };
    tracesService = { findOwnedTrace: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SpansService,
        { provide: PrismaService, useValue: prisma },
        { provide: TracesService, useValue: tracesService },
      ],
    }).compile();

    spansService = moduleRef.get(SpansService);
  });

  const baseDto = {
    name: 'call-llm',
    type: 'LLM' as const,
    startedAt: '2026-01-01T00:00:00.000Z',
  };

  describe('upsert', () => {
    it("rejects a trace that does not belong to the caller's project, before doing anything else", async () => {
      tracesService.findOwnedTrace.mockRejectedValue(
        new NotFoundException('Trace not found'),
      );

      await expect(
        spansService.upsert('project-1', 'trace-1', baseDto),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.span.create).not.toHaveBeenCalled();
    });

    it('creates a span when no parentSpanId is given', async () => {
      tracesService.findOwnedTrace.mockResolvedValue({ id: 'trace-1' });
      prisma.span.create.mockResolvedValue({ id: 'span-1' });

      await spansService.upsert('project-1', 'trace-1', baseDto);

      expect(prisma.span.create).toHaveBeenCalled();
      expect(prisma.span.findUnique).not.toHaveBeenCalled();
    });

    it('rejects a parentSpanId that does not reference any existing span', async () => {
      tracesService.findOwnedTrace.mockResolvedValue({ id: 'trace-1' });
      prisma.span.findUnique.mockResolvedValue(null);

      await expect(
        spansService.upsert('project-1', 'trace-1', {
          ...baseDto,
          parentSpanId: 'does-not-exist',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.span.create).not.toHaveBeenCalled();
    });

    it('rejects a parentSpanId that belongs to a different trace', async () => {
      tracesService.findOwnedTrace.mockResolvedValue({ id: 'trace-1' });
      prisma.span.findUnique.mockResolvedValue({
        id: 'parent-span',
        traceId: 'a-different-trace',
      });

      await expect(
        spansService.upsert('project-1', 'trace-1', {
          ...baseDto,
          parentSpanId: 'parent-span',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.span.create).not.toHaveBeenCalled();
    });

    it('rejects a span parenting itself', async () => {
      tracesService.findOwnedTrace.mockResolvedValue({ id: 'trace-1' });
      prisma.span.findUnique.mockResolvedValueOnce({
        id: 'span-1',
        traceId: 'trace-1',
      }); // the lookup-by-externalSpanId call

      await expect(
        spansService.upsert('project-1', 'trace-1', {
          ...baseDto,
          externalSpanId: 'external-1',
          parentSpanId: 'span-1',
        }),
      ).rejects.toThrow('A span cannot be its own parent');
      expect(prisma.span.upsert).not.toHaveBeenCalled();
    });

    it('accepts a parentSpanId that references a real span in the same trace', async () => {
      tracesService.findOwnedTrace.mockResolvedValue({ id: 'trace-1' });
      prisma.span.findUnique.mockResolvedValue({
        id: 'parent-span',
        traceId: 'trace-1',
      });
      prisma.span.create.mockResolvedValue({ id: 'span-1' });

      await spansService.upsert('project-1', 'trace-1', {
        ...baseDto,
        parentSpanId: 'parent-span',
      });

      expect(prisma.span.create).toHaveBeenCalled();
    });

    it('rejects an endedAt earlier than startedAt', async () => {
      tracesService.findOwnedTrace.mockResolvedValue({ id: 'trace-1' });

      await expect(
        spansService.upsert('project-1', 'trace-1', {
          ...baseDto,
          startedAt: '2026-01-01T00:05:00.000Z',
          endedAt: '2026-01-01T00:00:00.000Z',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.span.create).not.toHaveBeenCalled();
    });

    it('applies the RUNNING default on create, but not on update, when status is omitted', async () => {
      tracesService.findOwnedTrace.mockResolvedValue({ id: 'trace-1' });
      prisma.span.upsert.mockResolvedValue({ id: 'span-1' });

      await spansService.upsert('project-1', 'trace-1', {
        ...baseDto,
        externalSpanId: 'external-1',
      });

      const calls = prisma.span.upsert.mock.calls as {
        create: { status?: string };
        update: { status?: string };
      }[][];
      expect(calls[0][0].create.status).toBe('RUNNING');
      expect(calls[0][0].update.status).toBeUndefined();
    });
  });
});
