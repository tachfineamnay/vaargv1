import { Controller, Get } from '@nestjs/common';
import {
  versionSchema,
  type Health,
  type Readiness,
  type Version,
} from '@vaarg/shared';
import { HealthService, ReadinessService } from './health.service.js';

export function appVersion(): string {
  return (process.env.APP_VERSION ?? '1.0.0').trim();
}

export function appEnv(): Version['env'] {
  const raw = process.env.NODE_ENV;
  if (raw === 'production' || raw === 'test' || raw === 'development') {
    return raw;
  }
  return 'development';
}

@Controller('health')
export class HealthController {
  constructor(
    private readonly healthService: HealthService,
    private readonly readinessService: ReadinessService,
  ) {}

  @Get()
  live(): Health {
    return this.healthService.build('api', appVersion());
  }

  @Get('ready')
  async ready(): Promise<Readiness> {
    return this.readinessService.build('api', appVersion());
  }
}

@Controller()
export class VersionController {
  @Get('version')
  info(): Version {
    return versionSchema.parse({
      service: 'api',
      version: appVersion(),
      node: process.version,
      env: appEnv(),
    });
  }
}
