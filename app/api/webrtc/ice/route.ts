import { apiHandler, json } from '@/lib/api/handler';
import { requireSession } from '@/lib/api/guards';
import { serverEnv } from '@/lib/env.server';

export const runtime = 'nodejs';

export interface IceConfigResponse {
  iceServers: RTCIceServerConfig[];
  /** false quando não há TURN configurado — a UI avisa sobre a limitação. */
  hasTurn: boolean;
}

export interface RTCIceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/**
 * Configuração ICE para o WebRTC.
 *
 * As credenciais de TURN são entregues aqui, e não embutidas no bundle, por dois
 * motivos: (1) só usuário autenticado consome banda do TURN; (2) trocar a
 * credencial não exige rebuild do frontend.
 */
export async function GET() {
  return apiHandler('webrtc.ice', async () => {
    await requireSession();

    const env = serverEnv();
    const iceServers: RTCIceServerConfig[] = [];

    const stun = process.env.NEXT_PUBLIC_STUN_SERVER;
    if (stun) {
      iceServers.push({ urls: stun });
    }

    const hasTurn = Boolean(env.TURN_SERVER_URL && env.TURN_USERNAME && env.TURN_PASSWORD);
    if (hasTurn) {
      iceServers.push({
        urls: env.TURN_SERVER_URL,
        username: env.TURN_USERNAME,
        credential: env.TURN_PASSWORD,
      });
    }

    return json<IceConfigResponse>({ iceServers, hasTurn });
  });
}
