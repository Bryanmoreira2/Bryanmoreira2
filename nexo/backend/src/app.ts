import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config.js';
import type { DB } from './db/connection.js';
import { autenticar } from './middleware/auth.js';
import { tratarErros } from './middleware/error.js';
import { notFound } from './lib/errors.js';
import { authRouter } from './modules/auth/routes.js';
import { usuariosRouter } from './modules/usuarios/routes.js';
import { jovensRouter } from './modules/jovens/routes.js';
import { secretariaRouter } from './modules/secretaria/routes.js';
import { tesourariaRouter } from './modules/tesouraria/routes.js';
import { relatoriosRouter } from './modules/relatorios/routes.js';
import { auditoriaRouter } from './modules/auditoria/routes.js';

export function createApp(db: DB) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigin.split(','), credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.get('/api/saude', (_req, res) => res.json({ status: 'ok' }));

  app.use('/api/auth', authRouter(db));

  const protegido = express.Router();
  protegido.use(autenticar(db));
  protegido.use('/usuarios', usuariosRouter(db));
  protegido.use('/jovens', jovensRouter(db));
  protegido.use('/secretaria', secretariaRouter(db));
  protegido.use('/tesouraria', tesourariaRouter(db));
  protegido.use('/relatorios', relatoriosRouter(db));
  protegido.use('/auditoria', auditoriaRouter(db));
  app.use('/api', protegido);

  app.use((_req, _res, next) => next(notFound('Rota')));
  app.use(tratarErros);
  return app;
}
