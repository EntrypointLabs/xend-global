import { Connection } from '@solana/web3.js';

import { sendRawTransactionViaConnection } from './web3-connection';

describe('sendRawTransactionViaConnection', () => {
  it('leaves rebroadcasting to the RPC node', async () => {
    const send = jest.fn(() => Promise.resolve('signature'));
    const conn = { sendRawTransaction: send } as unknown as Connection;

    const signature = await sendRawTransactionViaConnection(
      conn,
      Buffer.from('signed').toString('base64'),
    );

    expect(signature).toBe('signature');
    const [, options] = send.mock.calls[0] as unknown as [
      Buffer,
      { maxRetries?: number },
    ];
    expect(options).not.toHaveProperty('maxRetries');
  });
});
