const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
/** Single poll loop; retry the same result until acknowledged before claiming more work. */
async function runTransport({ api, executor, signal, onStatus = () => {} }) {
  let delivery;
  while (!signal.aborted) {
    try {
      if (delivery) { await api('/api/local-bridge/agent/result', { method: 'POST', body: JSON.stringify(delivery) }); delivery = undefined; }
      if (signal.aborted) break;
      const body = await api('/api/local-bridge/agent/poll', { method: 'POST', body: '{}' });
      onStatus({ connected: true, error: '' });
      if (body.command) {
        delivery = { id: body.command.id, lease: body.command.lease, result: await executor.execute(body.command) };
      } else await pause(1000);
    } catch (error) { onStatus({ connected: false, error: error.message }); await pause(2000); }
  }
}
module.exports = { runTransport };
