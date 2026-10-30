// ─── Kitty – app shell ──────────────────────────────────────────────────────
// Nobody fronts the money.
//
//  - One deployment config (kitty-config.ts) decides the chain and contract.
//  - Routes are query params: ?kitty=<id>, ?view=mine, ?view=open, ?new=<kind|template>.
//  - Every write goes through useKittyTx (lock, approve-then-chip-in, uncertain retry).
import { useCallback, useEffect, useState } from 'react';
import { useAccount, useChainId, usePublicClient, useSwitchChain, useWalletClient } from 'wagmi';
import { erc20Abi, isAddress } from 'viem';
import { motion, useReducedMotion } from 'motion/react';

import { ACTIVE, ACTIVE_CHAIN_ID, footerNote, notDeployedTitle } from './kitty-config';
import { routeTab, type KittyDraft, type Route, type Tab } from './kitty-core';
import { ensureDeploymentValid, hasCachedValidation, resetDeploymentValidation, type MinimalPublicClient, type MinimalWalletClient } from './kitty-tx';
import { useKittyTx } from './useKittyTx';
import { useActivity, useKittyData, useMine } from './useKittyData';
import { useRoute } from './useRoute';
import { plain } from './pt-ui';

import { TopBar } from './components/TopBar';
import { TxIsland } from './components/TxIsland';
import { Home } from './components/Home';
import { CreateKitty } from './components/CreateKitty';
import { KittyPage, KittySkeleton } from './components/KittyPage';
import { KittyNotFound } from './components/KittyNotFound';
import { MyKitties } from './components/MyKitties';
import { OrderLookup, LookupEmpty } from './components/OrderLookup';
import { Button, EmptyState, Notice } from './components/ui';
import { useMainnetConfirm } from './components/useMainnetConfirm';

type DeployValidation =
  | { state: 'notDeployed' }    // no Kitty contract configured for this chain yet
  | { state: 'checking' }
  | { state: 'retrying' }       // the network is rate-limiting us; backing off
  | { state: 'valid' }
  | { state: 'invalid'; reason: string }  // a definitive mismatch
  | { state: 'unreachable' };   // retries exhausted

export default function App() {
  const reduceMotion = useReducedMotion();
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const publicClient = usePublicClient({ chainId: ACTIVE_CHAIN_ID });
  const { data: walletClientRaw } = useWalletClient({ chainId: ACTIVE_CHAIN_ID });
  const walletClient = walletClientRaw as unknown as MinimalWalletClient | undefined;

  const isCorrectChain = chainId === ACTIVE_CHAIN_ID;
  const me = isConnected ? address : undefined;
  const switchToActive = useCallback(() => switchChain({ chainId: ACTIVE_CHAIN_ID }), [switchChain]);

  const { route, navigate } = useRoute();
  const [createdId, setCreatedId] = useState<string | undefined>();
  const [refreshKey, setRefreshKey] = useState(0);
  const [deploy, setDeploy] = useState<DeployValidation>(() =>
    !ACTIVE.deployed ? { state: 'notDeployed' } : hasCachedValidation(ACTIVE) ? { state: 'valid' } : { state: 'checking' });
  const [deployAttempt, setDeployAttempt] = useState(0);
  const [balanceRaw, setBalanceRaw] = useState<bigint | undefined>();
  const [allowanceRaw, setAllowanceRaw] = useState<bigint | undefined>();

  // Deployment validation: bytecode, token() == USDC, decimals == 6.
  // Shared and cached per session; transient network errors back off and retry.
  useEffect(() => {
    if (!ACTIVE.deployed || !publicClient || hasCachedValidation(ACTIVE)) return;
    let cancelled = false;
    ensureDeploymentValid(publicClient as unknown as MinimalPublicClient, ACTIVE, {
      onRetry: (n, err) => {
        console.warn(`Kitty deployment check: network error, retry ${n}`, err);
        if (!cancelled) setDeploy({ state: 'retrying' });
      },
    })
      .then(r => {
        if (cancelled) return;
        if (r.ok) setDeploy({ state: 'valid' });
        else if (r.transient) { console.error('Kitty deployment check failed', r.cause); setDeploy({ state: 'unreachable' }); }
        else setDeploy({ state: 'invalid', reason: r.reason });
      })
      .catch(e => { console.error('Kitty deployment check crashed', e); if (!cancelled) setDeploy({ state: 'unreachable' }); });
    return () => { cancelled = true; };
  }, [publicClient, deployAttempt]);

  const retryDeploy = () => {
    resetDeploymentValidation(ACTIVE);
    setDeploy({ state: 'checking' });
    setDeployAttempt(n => n + 1);
  };

  // USDC balance and allowance for the connected wallet. Re-read after confirmed receipts.
  const [balanceTick, setBalanceTick] = useState(0);
  const refreshBalances = useCallback(() => setBalanceTick(t => t + 1), []);
  useEffect(() => {
    if (!ACTIVE.deployed || !publicClient || !me || !isCorrectChain) return;
    let cancelled = false;
    Promise.all([
      publicClient.readContract({ address: ACTIVE.usdc, abi: erc20Abi, functionName: 'balanceOf', args: [me] }),
      publicClient.readContract({ address: ACTIVE.usdc, abi: erc20Abi, functionName: 'allowance', args: [me, ACTIVE.kitty] }),
    ])
      .then(([bal, allow]) => { if (!cancelled) { setBalanceRaw(bal); setAllowanceRaw(allow); } })
      .catch(() => { /* non-fatal: the display stays stale */ });
    return () => { cancelled = true; };
  }, [publicClient, me, isCorrectChain, balanceTick]);

  // With no contract configured there is nothing to read: every read hook gets no client.
  const readClient = ACTIVE.deployed ? publicClient : undefined;
  const kittyId = route.view === 'kitty' ? route.id : undefined;
  const kitty = useKittyData(readClient, ACTIVE, kittyId, !!kittyId && createdId === kittyId);
  const activity = useActivity(readClient, ACTIVE, kittyId, refreshKey, !!kitty.data);
  const mine = useMine(route.view === 'mine' ? readClient : undefined, ACTIVE, route.view === 'mine' ? me : undefined);

  const mainnetConfirm = useMainnetConfirm(ACTIVE);

  const tx = useKittyTx({
    dep: ACTIVE,
    confirmWrite: mainnetConfirm.confirm,
    publicClient,
    walletClient,
    account: me,
    chainId,
    deploymentValid: deploy.state === 'valid',
    onDone: ({ op, createdId: newId }) => {
      refreshBalances();
      setRefreshKey(k => k + 1);
      if (op.kind === 'create' && newId) {
        setCreatedId(newId);
        navigate({ view: 'kitty', id: newId });
      } else {
        void kitty.refresh();
      }
    },
  });

  const deployBlocked = deploy.state !== 'valid';
  const onTab = (t: Tab) => navigate(t === 'new' ? { view: 'home' } : t === 'mine' ? { view: 'mine' } : { view: 'open' });
  const go = (r: Route) => navigate(r);
  const onCreate = (draft: KittyDraft, recipient: string) => void tx.createKitty(draft, recipient);

  return (
    <div className="min-h-dvh">
      <TopBar
        tab={routeTab(route)}
        onTab={onTab}
        onHome={() => navigate({ view: 'home' })}
        isConnected={isConnected}
        isCorrectChain={isCorrectChain}
        onSwitchChain={switchToActive}
      />

      {/* Transaction status: floating island, visible on every route */}
      <TxIsland status={tx.txStatus} explorerBase={ACTIVE.explorerBase} onRetry={tx.retry} />

      <main className="mx-auto max-w-5xl px-4 pb-[calc(2.5rem+env(safe-area-inset-bottom))]">
        <div className="space-y-2 pt-4 empty:hidden">
          {deploy.state === 'checking' && <Notice>Verifying the Kitty contract on {ACTIVE.name}...</Notice>}
          {deploy.state === 'retrying' && <Notice tone="warn">{ACTIVE.shortName} network is busy. Retrying...</Notice>}
          {deploy.state === 'unreachable' && (
            <Notice tone="warn">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span>Can't reach the {ACTIVE.shortName} network right now. Writes are paused until it answers.</span>
                <Button size="sm" variant="secondary" onClick={retryDeploy}>Retry</Button>
              </div>
            </Notice>
          )}
          {deploy.state === 'invalid' && (
            <Notice tone="err">
              <p className="font-medium text-ink">Contract validation failed</p>
              <p className="mt-0.5">{plain(deploy.reason)}. Writes are blocked until the contract is validated.</p>
            </Notice>
          )}
        </div>

        {deploy.state === 'notDeployed' ? (
          <NotDeployedState />
        ) : (
        <motion.div
          key={route.view === 'kitty' ? `kitty-${route.id}` : route.view === 'new' ? `new-${route.template ?? route.kind}` : route.view}
          initial={reduceMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, ease: 'easeOut' }}
        >
          {route.view === 'home' && <Home onNavigate={go} />}

          {route.view === 'new' && (
            <CreateKitty
              start={{ kind: route.kind, template: route.template }}
              dep={ACTIVE}
              connectedAddress={me}
              isCorrectChain={isCorrectChain}
              deployBlocked={deployBlocked}
              txBusy={tx.busy}
              onSubmit={onCreate}
            />
          )}

          {route.view === 'mine' && (
            <div className="pt-10 md:pt-14">
              <MyKitties
                me={me}
                scan={mine.scan}
                loading={mine.loading}
                refreshing={mine.refreshing}
                error={mine.error}
                onRefresh={mine.refresh}
                onNavigate={go}
              />
            </div>
          )}

          {route.view === 'open' && (
            <div className="space-y-6 pt-10 md:pt-14">
              <LookupHeader />
              <OrderLookup
                onLookup={id => navigate({ view: 'kitty', id })}
                loading={false}
                error={route.invalid ? 'That link does not carry a valid kitty ID.' : undefined}
              />
              <LookupEmpty />
            </div>
          )}

          {route.view === 'kitty' && (
            <div className="space-y-6 pt-10 md:pt-14">
              {kitty.loading && <KittySkeleton />}
              {kitty.notFound && <KittyNotFound networkName={ACTIVE.name} onNavigate={go} />}
              {kitty.error && !kitty.notFound && (
                <>
                  <LookupHeader />
                  <OrderLookup key={route.id} externalOrderId={route.id} onLookup={id => navigate({ view: 'kitty', id })} loading={false} error={kitty.error} />
                </>
              )}
              {kitty.data && (
                <KittyPage
                  data={kitty.data}
                  dep={ACTIVE}
                  connectedAddress={me}
                  isCorrectChain={isCorrectChain}
                  onSwitchChain={switchToActive}
                  txStatus={tx.txStatus}
                  allowanceRaw={allowanceRaw}
                  balanceRaw={balanceRaw}
                  onRefresh={() => { void kitty.refresh(); setRefreshKey(k => k + 1); refreshBalances(); }}
                  onChipIn={(amount, hasAllowance) => tx.chipIn(route.id, amount, hasAllowance, kitty.data && { ref: kitty.data.ref, recipient: kitty.data.recipient })}
                  onPayOut={() => tx.payOut(route.id, kitty.data && { ref: kitty.data.ref, recipient: kitty.data.recipient, goalRaw: kitty.data.goalRaw })}
                  onGetRefund={() => tx.getRefund(route.id, kitty.data && { ref: kitty.data.ref, amountRaw: kitty.data.contributors.find(c => c.address.toLowerCase() === me?.toLowerCase())?.contributedRaw ?? 0n })}
                  justCreated={createdId === route.id}
                  activity={{ items: activity.items, loading: activity.loading, error: activity.error, retry: activity.retry }}
                />
              )}
            </div>
          )}
        </motion.div>
        )}

        <footer className="mt-16 max-w-2xl space-y-2 border-t border-line pb-[calc(6rem+env(safe-area-inset-bottom))] pt-6 text-xs leading-relaxed text-ink-3 lg:pb-8">
          <p>
            {footerNote(ACTIVE)}{' '}
            USDC is an ERC-20 at <span className="mono">{ACTIVE.usdc.slice(0, 6)}…{ACTIVE.usdc.slice(-4)}</span> with {ACTIVE.usdcDecimals} decimals, and gas is paid from the same balance.
          </p>
          <p>
            A payout is one payment to the recipient and cannot be reversed. Delivery is between the people involved.
            Paying out and getting a refund are manual onchain calls, and nothing is sent unless your wallet approves it.
          </p>
          {address && isAddress(address) && <p>Connected <span className="mono break-all">{address}</span></p>}
        </footer>
      </main>

      {/* Mainnet only: the one-time "what is about to happen" confirmation. */}
      {mainnetConfirm.dialog}
    </div>
  );
}

/** Shown for every route while no Kitty contract is configured for the active chain. Nothing is read or sent. */
function NotDeployedState() {
  return (
    <div className="pt-10 md:pt-14">
      <EmptyState title={notDeployedTitle(ACTIVE)}>
        Nothing can be started, funded or paid out here until the contract is live. Check back soon.
      </EmptyState>
    </div>
  );
}

function LookupHeader() {
  return (
    <div className="max-w-2xl space-y-3">
      <h1 className="text-3xl font-semibold leading-tight tracking-[-0.03em] text-ink text-balance md:text-4xl">Open a kitty</h1>
      <p className="text-base leading-relaxed text-ink-2 text-pretty">See who has chipped in, how much is left, and what happens next.</p>
    </div>
  );
}
