import { spawn, ChildProcess } from 'child_process';
import { retrieveEnv, logger } from './lib';
import { Connection } from './lib/backpack';

const SYMBOL = retrieveEnv('SYMBOL');
const CHECK_INTERVAL = 5000;

const connection = new Connection(
    retrieveEnv('BACKPACK_API_KEY'),
    retrieveEnv('BACKPACK_API_SECRET')
);

let currentApp: ChildProcess | null = null;
let currentRange: { lowerPrice: number; upperPrice: number } = { lowerPrice: 0, upperPrice: 0 };

async function calculateDynamicRange(): Promise<{ lowerPrice: number; upperPrice: number }> {
    const RANGE_OFFSET = parseFloat(retrieveEnv('RANGE_OFFSET'));
    const { lastPrice } = await connection.apiCall("ticker", { symbol: SYMBOL });

    if (!lastPrice || isNaN(parseFloat(lastPrice))) {
        throw new Error(`Preço inválido recebido para ${SYMBOL}: ${lastPrice}`);
    }

    const price = parseFloat(lastPrice);

    return {
        lowerPrice: price - RANGE_OFFSET,
        upperPrice: price + RANGE_OFFSET
    };
}

function startAppWithRange(lowerPrice: number, upperPrice: number) {
    if (currentApp) {
        logger.info("Encerrando processo anterior do app.ts...");
        currentApp.kill();
    }

    logger.info(`Iniciando novo app.ts com range: ${lowerPrice.toFixed(2)} ~ ${upperPrice.toFixed(2)}`);
    currentApp = spawn('node', ['dist/app.js', lowerPrice.toString(), upperPrice.toString()], {
        stdio: 'inherit'
    });

    currentRange = { lowerPrice, upperPrice };
}

async function checkPriceLoop() {
    while (true) {
        try {
            const { lastPrice } = await connection.apiCall("ticker", { symbol: SYMBOL });

            if (!lastPrice || isNaN(parseFloat(lastPrice))) {
                logger.warn(`Preço inválido recebido para ${SYMBOL}: ${lastPrice}`);
                continue;
            }

            const price = parseFloat(lastPrice);
            logger.info(`Preço atual de ${SYMBOL}: ${price.toFixed(2)}`);

            if (price < currentRange.lowerPrice || price > currentRange.upperPrice) {
                logger.warn(`Preço saiu do range! Recalculando e reiniciando app.ts...`);
                const { lowerPrice, upperPrice } = await calculateDynamicRange();
                startAppWithRange(lowerPrice, upperPrice);
            }
        } catch (e) {
            logger.error(`Erro ao verificar preço: ${e}`);
        }

        await new Promise((res) => setTimeout(res, CHECK_INTERVAL));
    }
}

// Inicializa o range e inicia o bot
(async () => {
    try {
        const { lowerPrice, upperPrice } = await calculateDynamicRange();
        startAppWithRange(lowerPrice, upperPrice);
        await checkPriceLoop();
    } catch (e) {
        logger.error(`Erro na inicialização do bot: ${e}`);
        process.exit(1);
    }
})();
