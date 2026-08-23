import { defineConfig } from 'vitest/config';
import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config';

// Duas suítes, dois ambientes, porque testam coisas diferentes:
//
//   worker  — roda dentro do workerd, o mesmo runtime da Cloudflare, com um D1
//             local de verdade. É o comportamento do endpoint de cadastro.
//   paginas — roda no Node comum, porque lê os HTML do disco e o workerd não
//             tem sistema de arquivos.
export default defineConfig({
  test: {
    projects: [
      defineWorkersProject({
        test: {
          name: 'worker',
          include: ['test/leads.spec.js'],
          poolOptions: {
            workers: {
              wrangler: { configPath: './wrangler.toml' },
              miniflare: {
                bindings: { AXIS_ADMIN_TOKEN: 'token-de-teste-123', AXIS_SAL: 'sal-de-teste' },
                d1Databases: ['DB'],
              },
            },
          },
        },
      }),
      {
        test: {
          name: 'paginas',
          include: ['test/paginas.spec.js'],
          environment: 'node',
        },
      },
    ],
  },
});
