import {
  createStakeEntryAndStakeMint,
  stake,
  unstake,
  claimRewards,
} from '@cardinal/staking'
import { ReceiptType } from '@cardinal/staking/dist/cjs/programs/stakePool'
import { useWallet } from '@solana/wallet-adapter-react'
import { PublicKey, Signer, Transaction } from '@solana/web3.js'
import { Header } from 'common/Header'
import Head from 'next/head'
import { useEnvironmentCtx } from 'providers/EnvironmentProvider'
import { useEffect, useState } from 'react'
import { Wallet } from '@metaplex/js'
import { LoadingSpinner } from 'common/LoadingSpinner'
import { notify } from 'common/Notification'
import { contrastColorMode } from 'common/utils'
import {
  parseMintNaturalAmountFromDecimal,
} from 'common/units'
import { BN } from '@project-serum/anchor'
import {
  StakeEntryTokenData,
  useStakedTokenDatas,
} from 'hooks/useStakedTokenDatas'
import { useStakePoolEntries } from 'hooks/useStakePoolEntries'
import { useStakePoolData } from 'hooks/useStakePoolData'
import {
  AllowedTokenData,
  useAllowedTokenDatas,
} from 'hooks/useAllowedTokenDatas'
import { useStakePoolMetadata } from 'hooks/useStakePoolMetadata'
import { defaultSecondaryColor, TokenStandard } from 'api/mapping'
import { DisplayAddress } from '@cardinal/namespaces-components'
import { Switch } from '@headlessui/react'
import { FaInfoCircle } from 'react-icons/fa'
import { MouseoverTooltip } from 'common/Tooltip'
import { useWalletModal } from '@solana/wallet-adapter-react-ui'
import { executeAllTransactions } from 'api/utils'
import { useRouter } from 'next/router'
import { lighten, darken } from '@mui/material'
import { QuickActions } from 'common/QuickActions'

function Home() {
  const router = useRouter()
  const { connection, environment } = useEnvironmentCtx()
  const wallet = useWallet()
  const walletModal = useWalletModal()
  const { data: stakePool, isFetched: stakePoolLoaded } = useStakePoolData()
  const stakedTokenDatas = useStakedTokenDatas()
  const stakePoolEntries = useStakePoolEntries()

  const [unstakedSelected, setUnstakedSelected] = useState<AllowedTokenData[]>(
    []
  )
  const [stakedSelected, setStakedSelected] = useState<StakeEntryTokenData[]>(
    []
  )
  const [loadingStake, setLoadingStake] = useState(false)
  const [loadingUnstake, setLoadingUnstake] = useState(false)
  const [singleTokenAction, setSingleTokenAction] = useState('')
  const [receiptType, setReceiptType] = useState<ReceiptType>(
    ReceiptType.Original
  )
  const [loadingClaimRewards, setLoadingClaimRewards] = useState(false)
  const [showFungibleTokens, setShowFungibleTokens] = useState(false)
  const allowedTokenDatas = useAllowedTokenDatas(showFungibleTokens)
  const { data: stakePoolMetadata } = useStakePoolMetadata()

  if (stakePoolMetadata?.redirect) {
    router.push(stakePoolMetadata?.redirect)
    return
  }

  useEffect(() => {
    stakePoolMetadata?.tokenStandard &&
      setShowFungibleTokens(
        stakePoolMetadata?.tokenStandard === TokenStandard.NonFungible
      )
    stakePoolMetadata?.receiptType &&
      setReceiptType(stakePoolMetadata?.receiptType)
  }, [stakePoolMetadata?.name])

  async function handleClaimRewards(all?: boolean) {
    setLoadingClaimRewards(true)
    if (!wallet) {
      throw new Error('Wallet not connected')
    }
    if (!stakePool) {
      notify({ message: `No stake pool detected`, type: 'error' })
      return
    }

    const txs: (Transaction | null)[] = await Promise.all(
      (all ? stakedTokenDatas.data || [] : stakedSelected).map(
        async (token) => {
          try {
            if (!token || !token.stakeEntry) {
              throw new Error('No stake entry for token')
            }
            return claimRewards(connection, wallet as Wallet, {
              stakePoolId: stakePool.pubkey,
              stakeEntryId: token.stakeEntry.pubkey,
            })
          } catch (e) {
            notify({
              message: `${e}`,
              description: `Failed to claim rewards for token ${token?.stakeEntry?.pubkey.toString()}`,
              type: 'error',
            })
            return null
          }
        }
      )
    )
    try {
      await executeAllTransactions(
        connection,
        wallet as Wallet,
        txs.filter((tx): tx is Transaction => tx !== null),
        {
          notificationConfig: {
            message: 'Successfully claimed rewards',
            description: 'These rewards are now available in your wallet',
          },
        }
      )
    } catch (e) {}

    setLoadingClaimRewards(false)
    setStakedSelected([])
  }

  async function handleUnstake(all?: boolean) {
    const tokensToUnstake = all ? stakedTokenDatas.data || [] : stakedSelected
    if (!wallet.connected) {
      notify({ message: `Wallet not connected`, type: 'error' })
      return
    }
    if (!stakePool) {
      notify({ message: `No stake pool detected`, type: 'error' })
      return
    }
    if (tokensToUnstake.length <= 0) {
      notify({ message: `Not tokens selected`, type: 'error' })
      return
    }
    setLoadingUnstake(true)

    let coolDown = false
    const txs: (Transaction | null)[] = await Promise.all(
      tokensToUnstake.map(async (token) => {
        try {
          if (!token || !token.stakeEntry) {
            throw new Error('No stake entry for token')
          }
          if (
            stakePool.parsed.cooldownSeconds &&
            !token.stakeEntry?.parsed.cooldownStartSeconds &&
            !stakePool.parsed.minStakeSeconds
          ) {
            notify({
              message: `Cooldown period will be initiated for ${token.metaplexData?.data.data.name} unless minimum stake period unsatisfied`,
              type: 'info',
            })
            coolDown = true
          }
          return unstake(connection, wallet as Wallet, {
            stakePoolId: stakePool?.pubkey,
            originalMintId: token.stakeEntry.parsed.originalMint,
          })
        } catch (e) {
          notify({
            message: `${e}`,
            description: `Failed to unstake token ${token?.stakeEntry?.pubkey.toString()}`,
            type: 'error',
          })
          return null
        }
      })
    )

    try {
      await executeAllTransactions(
        connection,
        wallet as Wallet,
        txs.filter((tx): tx is Transaction => tx !== null),
        {
          notificationConfig: {
            message: `Successfully ${
              coolDown ? 'initiated cooldown' : 'unstaked'
            }`,
            description: 'These tokens are now available in your wallet',
          },
        }
      )
    } catch (e) {}

    await Promise.all([
      stakedTokenDatas.remove(),
      allowedTokenDatas.remove(),
      stakePoolEntries.remove(),
    ]).then(() =>
      setTimeout(() => {
        stakedTokenDatas.refetch()
        allowedTokenDatas.refetch()
        stakePoolEntries.refetch()
      }, 2000)
    )
    setStakedSelected([])
    setUnstakedSelected([])
    setLoadingUnstake(false)
  }

  async function handleStake(all?: boolean) {
    const tokensToStake = all ? allowedTokenDatas.data || [] : unstakedSelected
    if (!wallet.connected) {
      notify({ message: `Wallet not connected`, type: 'error' })
      return
    }
    if (!stakePool) {
      notify({ message: `Wallet not connected`, type: 'error' })
      return
    }
    if (tokensToStake.length <= 0) {
      notify({ message: `Not tokens selected`, type: 'error' })
      return
    }
    setLoadingStake(true)

    const initTxs: { tx: Transaction; signers: Signer[] }[] = []
    for (let step = 0; step < tokensToStake.length; step++) {
      try {
        let token = tokensToStake[step]
        if (!token || !token.tokenAccount) {
          throw new Error('Token account not set')
        }

        if (
          token.tokenAccount?.account.data.parsed.info.tokenAmount.amount > 1 &&
          !token.amountToStake
        ) {
          throw new Error('Invalid amount chosen for token')
        }

        if (receiptType === ReceiptType.Receipt) {
          console.log('Creating stake entry and stake mint...')
          const [initTx, , stakeMintKeypair] =
            await createStakeEntryAndStakeMint(connection, wallet as Wallet, {
              stakePoolId: stakePool?.pubkey,
              originalMintId: new PublicKey(
                token.tokenAccount.account.data.parsed.info.mint
              ),
            })
          if (initTx.instructions.length > 0) {
            initTxs.push({
              tx: initTx,
              signers: stakeMintKeypair ? [stakeMintKeypair] : [],
            })
          }
        }
      } catch (e) {
        notify({
          message: `Failed to stake token ${tokensToStake[
            step
          ]?.stakeEntry?.pubkey.toString()}`,
          description: `${e}`,
          type: 'error',
        })
      }
    }

    if (initTxs.length > 0) {
      try {
        await executeAllTransactions(
          connection,
          wallet as Wallet,
          initTxs.map(({ tx }) => tx),
          {
            signers: initTxs.map(({ signers }) => signers),
            notificationConfig: {
              message: `Successfully staked`,
              description: 'Stake progress will now dynamically update',
            },
          }
        )
      } catch (e) {}
    }

    const txs: (Transaction | null)[] = await Promise.all(
      tokensToStake.map(async (token) => {
        try {
          if (!token || !token.tokenAccount) {
            throw new Error('Token account not set')
          }

          if (
            token.tokenAccount?.account.data.parsed.info.tokenAmount.amount >
              1 &&
            !token.amountToStake
          ) {
            throw new Error('Invalid amount chosen for token')
          }

          if (
            token.stakeEntry &&
            token.stakeEntry.parsed.amount.toNumber() > 0
          ) {
            throw new Error(
              'Fungible tokens already staked in the pool. Staked tokens need to be unstaked and then restaked together with the new tokens.'
            )
          }

          const amount = token?.amountToStake
            ? new BN(
                token?.amountToStake && token.tokenListData
                  ? parseMintNaturalAmountFromDecimal(
                      token?.amountToStake,
                      token.tokenListData.decimals
                    ).toString()
                  : 1
              )
            : undefined
          // stake
          return stake(connection, wallet as Wallet, {
            stakePoolId: stakePool?.pubkey,
            receiptType:
              !amount || (amount && amount.eq(new BN(1)))
                ? receiptType
                : undefined,
            originalMintId: new PublicKey(
              token.tokenAccount.account.data.parsed.info.mint
            ),
            userOriginalMintTokenAccountId: token.tokenAccount?.pubkey,
            amount: amount,
          })
        } catch (e) {
          notify({
            message: `Failed to unstake token ${token?.stakeEntry?.pubkey.toString()}`,
            description: `${e}`,
            type: 'error',
          })
          return null
        }
      })
    )

    try {
      await executeAllTransactions(
        connection,
        wallet as Wallet,
        txs.filter((tx): tx is Transaction => tx !== null),
        {
          notificationConfig: {
            message: `Successfully staked`,
            description: 'Stake progress will now dynamically update',
          },
        }
      )
    } catch (e) {}

    await Promise.all([
      stakedTokenDatas.remove(),
      allowedTokenDatas.remove(),
      stakePoolEntries.remove(),
    ]).then(() =>
      setTimeout(() => {
        stakedTokenDatas.refetch()
        allowedTokenDatas.refetch()
        stakePoolEntries.refetch()
      }, 2000)
    )
    setStakedSelected([])
    setUnstakedSelected([])
    setLoadingStake(false)
  }

  const selectUnstakedToken = (tk: AllowedTokenData, targetValue?: string) => {
    if (loadingStake || loadingUnstake) return
    const amount = Number(targetValue)
    if (tk.tokenAccount?.account.data.parsed.info.tokenAmount.amount > 1) {
      let newUnstakedSelected = unstakedSelected.filter(
        (data) =>
          data.tokenAccount?.account.data.parsed.info.mint.toString() !==
          tk.tokenAccount?.account.data.parsed.info.mint.toString()
      )
      if (targetValue && targetValue?.length > 0 && !amount) {
        notify({
          message: 'Please enter a valid amount',
          type: 'error',
        })
      } else if (targetValue) {
        tk.amountToStake = targetValue.toString()
        newUnstakedSelected = [...newUnstakedSelected, tk]
        setUnstakedSelected(newUnstakedSelected)
        return
      }
      setUnstakedSelected(
        unstakedSelected.filter(
          (data) =>
            data.tokenAccount?.account.data.parsed.info.mint.toString() !==
            tk.tokenAccount?.account.data.parsed.info.mint.toString()
        )
      )
    } else {
      if (isUnstakedTokenSelected(tk)) {
        setUnstakedSelected(
          unstakedSelected.filter(
            (data) =>
              data.tokenAccount?.account.data.parsed.info.mint.toString() !==
              tk.tokenAccount?.account.data.parsed.info.mint.toString()
          )
        )
      } else {
        setUnstakedSelected([...unstakedSelected, tk])
      }
    }
  }

  const selectStakedToken = (tk: StakeEntryTokenData) => {
    if (loadingStake || loadingUnstake) return
    if (
      tk.stakeEntry?.parsed.lastStaker.toString() !==
      wallet.publicKey?.toString()
    ) {
      return
    }
    if (isStakedTokenSelected(tk)) {
      setStakedSelected(
        stakedSelected.filter(
          (data) =>
            data.stakeEntry?.pubkey.toString() !==
            tk.stakeEntry?.pubkey.toString()
        )
      )
    } else {
      setStakedSelected([...stakedSelected, tk])
    }
  }

  const isUnstakedTokenSelected = (tk: AllowedTokenData) =>
    unstakedSelected.some(
      (utk) =>
        utk.tokenAccount?.account.data.parsed.info.mint.toString() ===
        tk.tokenAccount?.account.data.parsed.info.mint.toString()
    )
  const isStakedTokenSelected = (tk: StakeEntryTokenData) =>
    stakedSelected.some(
      (stk) =>
        stk.stakeEntry?.parsed.originalMint.toString() ===
        tk.stakeEntry?.parsed.originalMint.toString()
    )

  if (!stakePoolLoaded) {
    return
  }

  return (
    <div
      style={{
        background: stakePoolMetadata?.colors?.primary,
        backgroundImage: `url(${stakePoolMetadata?.backgroundImage})`,
      }}
    >
      <Head>
        <title>Non-custodial Staking</title>
        <meta name="description" content="Generated by Alexandr Stepan" />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <Header />
      <div
        className={`container mx-auto w-full`}
        style={{
          ...stakePoolMetadata?.styles,
          color:
            stakePoolMetadata?.colors?.fontColor ??
            contrastColorMode(
              stakePoolMetadata?.colors?.primary || '#000000'
            )[0],
        }}
      >
        {(!stakePool && stakePoolLoaded) || stakePoolMetadata?.notFound ? (
          <div
            className="mx-5 mb-5 rounded-md border-[1px] bg-opacity-40 p-4 text-center text-lg font-semibold"
            style={{
              background:
                stakePoolMetadata?.colors?.secondary || defaultSecondaryColor,
              color: stakePoolMetadata?.colors?.fontColor,
              borderColor: lighten(
                stakePoolMetadata?.colors?.secondary || defaultSecondaryColor,
                0.5
              ),
            }}
          >
            Stake pool not found
          </div>
        ) : (
          !wallet.connected && (
            <div
              className={`mx-5 mb-5 cursor-pointer rounded-md border-[1px]  p-4 text-center text-lg font-semibold ${
                stakePoolMetadata?.colors?.accent &&
                stakePoolMetadata?.colors.fontColor
                  ? ''
                  : 'border-yellow-500 bg-yellow-500 bg-opacity-40'
              }`}
              style={
                stakePoolMetadata?.colors?.accent &&
                stakePoolMetadata?.colors.fontColor
                  ? {
                      background: stakePoolMetadata?.colors?.secondary,
                      borderColor: stakePoolMetadata?.colors?.accent,
                      color: stakePoolMetadata?.colors?.fontColor,
                    }
                  : {}
              }
              onClick={() => walletModal.setVisible(true)}
            >
              Connect wallet to continue
            </div>
          )
        )}
        
        <div className="my-2 mx-5 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div
            className={`flex-col rounded-md p-10 ${
              stakePoolMetadata?.colors?.fontColor
                ? `text-[${stakePoolMetadata?.colors?.fontColor}]`
                : 'text-gray-200'
            } ${
              stakePoolMetadata?.colors?.backgroundSecondary
                ? `bg-[${stakePoolMetadata?.colors?.backgroundSecondary}]`
                : 'bg-white bg-opacity-5'
            }`}
            style={{
              background: stakePoolMetadata?.colors?.backgroundSecondary,
              border: stakePoolMetadata?.colors?.accent
                ? `2px solid ${stakePoolMetadata?.colors?.accent}`
                : '',
            }}
          >
            <div className="mt-2 flex w-full flex-row justify-between">
              <div className="flex flex-row">
                <p className="mb-3 mr-3 inline-block text-lg">
                  Select Your Tokens
                </p>
                <div className="inline-block">
                  {allowedTokenDatas.isRefetching &&
                    allowedTokenDatas.isFetched && (
                      <LoadingSpinner
                        fill={
                          stakePoolMetadata?.colors?.fontColor
                            ? stakePoolMetadata?.colors?.fontColor
                            : '#FFF'
                        }
                        height="25px"
                      />
                    )}
                </div>
              </div>
            </div>
            <div className="my-3 flex-auto overflow-auto">
              <div
                className="relative my-auto mb-4 h-[60vh] overflow-y-auto overflow-x-hidden rounded-md bg-white bg-opacity-5 p-5"
                style={{
                  background:
                    stakePoolMetadata?.colors?.backgroundSecondary &&
                    (contrastColorMode(
                      stakePoolMetadata?.colors?.primary ?? '#000000'
                    )[1]
                      ? lighten(
                          stakePoolMetadata?.colors?.backgroundSecondary,
                          0.05
                        )
                      : darken(
                          stakePoolMetadata?.colors?.backgroundSecondary,
                          0.05
                        )),
                }}
              >
                {!allowedTokenDatas.isFetched ? (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                    <div className="h-[200px] animate-pulse rounded-lg bg-white bg-opacity-5 p-10"></div>
                    <div className="h-[200px] animate-pulse rounded-lg bg-white bg-opacity-5 p-10"></div>
                    <div className="h-[200px] animate-pulse rounded-lg bg-white bg-opacity-5 p-10"></div>
                  </div>
                ) : (allowedTokenDatas.data || []).length == 0 ? (
                  <p
                    className={`font-normal text-[${
                      stakePoolMetadata?.colors?.fontColor
                        ? `text-[${stakePoolMetadata?.colors?.fontColor}]`
                        : 'text-gray-400'
                    }]`}
                  >
                    No allowed tokens found in wallet.
                  </p>
                ) : (
                  <div
                    className={
                      'grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3'
                    }
                  >
                    {(
                      (!stakePoolMetadata?.notFound &&
                        allowedTokenDatas.data) ||
                      []
                    ).map((tk) => (
                      <div
                        key={tk.tokenAccount?.pubkey.toString()}
                        className="mx-auto"
                      >
                        <div className="relative w-44 md:w-auto 2xl:w-48">
                          <label
                            htmlFor={tk?.tokenAccount?.pubkey.toBase58()}
                            className="relative"
                          >
                            <div
                              className="relative cursor-pointer rounded-xl"
                              onClick={() => selectUnstakedToken(tk)}
                              style={{
                                boxShadow: isUnstakedTokenSelected(tk)
                                  ? `0px 0px 20px ${
                                      stakePoolMetadata?.colors?.secondary ||
                                      'white'
                                    }`
                                  : '',
                              }}
                            >
                              {loadingStake &&
                                (isUnstakedTokenSelected(tk) ||
                                  singleTokenAction ===
                                    tk.tokenAccount?.account.data.parsed.info.mint.toString()) && (
                                  <div>
                                    <div className="absolute top-0 left-0 z-10 flex h-full w-full justify-center rounded-xl bg-black bg-opacity-80 align-middle text-white">
                                      <div className="my-auto flex">
                                        <span className="mr-2">
                                          <LoadingSpinner height="20px" />
                                        </span>
                                        Staking token...
                                      </div>
                                    </div>
                                  </div>
                                )}
                              <QuickActions
                                receiptType={receiptType}
                                unstakedTokenData={tk}
                                showFungibleTokens={showFungibleTokens}
                                setStakedSelected={setStakedSelected}
                                setUnstakedSelected={setUnstakedSelected}
                                setLoadingStake={setLoadingStake}
                                setLoadingUnstake={setLoadingUnstake}
                                setLoadingClaimRewards={setLoadingClaimRewards}
                                setSingleTokenAction={setSingleTokenAction}
                                selectUnstakedToken={selectUnstakedToken}
                                selectStakedToken={selectStakedToken}
                              />
                              <img
                                className="mx-auto mt-4 rounded-t-xl bg-white bg-opacity-5 object-contain md:h-40 md:w-40 2xl:h-48 2xl:w-48"
                                src={
                                  tk.metadata?.data.image ||
                                  tk.tokenListData?.logoURI
                                }
                                alt={
                                  tk.metadata?.data.name ||
                                  tk.tokenListData?.name
                                }
                              />
                              <div
                                className={`flex-col rounded-b-xl p-2 ${
                                  stakePoolMetadata?.colors?.fontColor
                                    ? `text-[${stakePoolMetadata?.colors?.fontColor}]`
                                    : 'text-gray-200'
                                } ${
                                  stakePoolMetadata?.colors?.backgroundSecondary
                                    ? `bg-[${stakePoolMetadata?.colors?.backgroundSecondary}]`
                                    : 'bg-white bg-opacity-10'
                                }`}
                                style={{
                                  background:
                                    stakePoolMetadata?.colors
                                      ?.backgroundSecondary,
                                }}
                              >
                                <div className="truncate font-semibold">
                                  {tk.metadata?.data.name ||
                                    tk.tokenListData?.symbol}
                                </div>
                                
                              </div>
                            </div>
                            {isUnstakedTokenSelected(tk) && (
                              <div
                                className={`absolute top-2 left-2`}
                                style={{
                                  height: '10px',
                                  width: '10px',
                                  backgroundColor:
                                    stakePoolMetadata?.colors?.primary ||
                                    'white',
                                  borderRadius: '50%',
                                  display: 'inline-block',
                                }}
                              />
                            )}
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-2 flex items-center justify-between gap-5">
              {!stakePoolMetadata?.receiptType && !showFungibleTokens ? (
                <MouseoverTooltip
                  title={
                    receiptType === ReceiptType.Original
                      ? 'Lock the original token(s) in your wallet when you stake'
                      : 'Receive a dynamically generated NFT receipt representing your stake'
                  }
                >
                  <div className="flex cursor-pointer flex-row gap-2">
                    <Switch
                      checked={receiptType === ReceiptType.Original}
                      onChange={() =>
                        setReceiptType(
                          receiptType === ReceiptType.Original
                            ? ReceiptType.Receipt
                            : ReceiptType.Original
                        )
                      }
                      style={{
                        background:
                          stakePoolMetadata?.colors?.secondary ||
                          defaultSecondaryColor,
                        color: stakePoolMetadata?.colors?.fontColor,
                      }}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full`}
                    >
                      <span className="sr-only">Receipt Type</span>
                      <span
                        className={`${
                          receiptType === ReceiptType.Original
                            ? 'translate-x-6'
                            : 'translate-x-1'
                        } inline-block h-4 w-4 transform rounded-full bg-white`}
                      />
                    </Switch>
                    <div className="flex items-center gap-1">
                      <span
                        style={{
                          color: stakePoolMetadata?.colors?.fontColor,
                        }}
                      >
                        {receiptType === ReceiptType.Original
                          ? 'Original'
                          : 'Receipt'}
                      </span>
                      <FaInfoCircle />
                    </div>
                  </div>
                </MouseoverTooltip>
              ) : (
                <div></div>
              )}
              <div className="flex gap-5">
                <MouseoverTooltip title="Click on tokens to select them">
                  <button
                    onClick={() => {
                      if (unstakedSelected.length === 0) {
                        notify({
                          message: `No tokens selected`,
                          type: 'error',
                        })
                      } else {
                        handleStake()
                      }
                    }}
                    style={{
                      background:
                        stakePoolMetadata?.colors?.secondary ||
                        defaultSecondaryColor,
                      color:
                        stakePoolMetadata?.colors?.fontColorSecondary ||
                        stakePoolMetadata?.colors?.fontColor,
                    }}
                    className="my-auto flex rounded-md px-4 py-2 hover:scale-[1.03]"
                  >
                    <span className="mr-1 inline-block">
                      {loadingStake && (
                        <LoadingSpinner
                          fill={
                            stakePoolMetadata?.colors?.fontColor
                              ? stakePoolMetadata?.colors?.fontColor
                              : '#FFF'
                          }
                          height="20px"
                        />
                      )}
                    </span>
                    <span className="my-auto">
                      Stake ({unstakedSelected.length})
                    </span>
                  </button>
                </MouseoverTooltip>
                <MouseoverTooltip title="Attempt to stake all tokens at once">
                  <button
                    onClick={() => {
                      setUnstakedSelected(allowedTokenDatas.data || [])
                      handleStake(true)
                    }}
                    style={{
                      background:
                        stakePoolMetadata?.colors?.secondary ||
                        defaultSecondaryColor,
                      color:
                        stakePoolMetadata?.colors?.fontColorSecondary ||
                        stakePoolMetadata?.colors?.fontColor,
                    }}
                    className="my-auto flex cursor-pointer rounded-md px-4 py-2 hover:scale-[1.03]"
                  >
                    <span className="mr-1 inline-block">
                      {loadingStake && (
                        <LoadingSpinner
                          fill={
                            stakePoolMetadata?.colors?.fontColor
                              ? stakePoolMetadata?.colors?.fontColor
                              : '#FFF'
                          }
                          height="20px"
                        />
                      )}
                    </span>
                    <span className="my-auto">Stake All</span>
                  </button>
                </MouseoverTooltip>
              </div>
            </div>
          </div>
          <div
            className={`rounded-md p-10 ${
              stakePoolMetadata?.colors?.fontColor ? '' : 'text-gray-200'
            } bg-white bg-opacity-5`}
            style={{
              background: stakePoolMetadata?.colors?.backgroundSecondary,
              border: stakePoolMetadata?.colors?.accent
                ? `2px solid ${stakePoolMetadata?.colors?.accent}`
                : '',
            }}
          >
            <div className="mb-5 flex flex-row justify-between">
              <div className="mt-2 flex flex-row">
                <p className="mr-3 text-lg">
                  View Staked Tokens{' '}
                  {stakedTokenDatas.isFetched &&
                    stakedTokenDatas.data &&
                    `(${stakedTokenDatas.data.length})`}
                </p>
                <div className="inline-block">
                  {stakedTokenDatas.isRefetching &&
                    stakedTokenDatas.isFetched && (
                      <LoadingSpinner
                        fill={
                          stakePoolMetadata?.colors?.fontColor
                            ? stakePoolMetadata?.colors?.fontColor
                            : '#FFF'
                        }
                        height="25px"
                      />
                    )}
                </div>
              </div>
            </div>
            <div className="my-3 flex-auto overflow-auto">
              <div
                className="relative my-auto mb-4 h-[60vh] overflow-y-auto overflow-x-hidden rounded-md bg-white bg-opacity-5 p-5"
                style={{
                  background:
                    stakePoolMetadata?.colors?.backgroundSecondary &&
                    (contrastColorMode(
                      stakePoolMetadata?.colors?.primary ?? '#000000'
                    )[1]
                      ? lighten(
                          stakePoolMetadata?.colors?.backgroundSecondary,
                          0.05
                        )
                      : darken(
                          stakePoolMetadata?.colors?.backgroundSecondary,
                          0.05
                        )),
                }}
              >
                {!stakedTokenDatas.isFetched ? (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                    <div className="h-[200px] animate-pulse rounded-lg bg-white bg-opacity-5 p-10"></div>
                    <div className="h-[200px] animate-pulse rounded-lg bg-white bg-opacity-5 p-10"></div>
                    <div className="h-[200px] animate-pulse rounded-lg bg-white bg-opacity-5 p-10"></div>
                  </div>
                ) : stakedTokenDatas.data?.length === 0 ? (
                  <p
                    className={`font-normal text-[${
                      stakePoolMetadata?.colors?.fontColor
                        ? ''
                        : 'text-gray-400'
                    }]`}
                  >
                    No tokens currently staked.
                  </p>
                ) : (
                  <div
                    className={
                      'grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3'
                    }
                  >
                    {!stakePoolMetadata?.notFound &&
                      stakedTokenDatas.data &&
                      stakedTokenDatas.data.map((tk) => (
                        <div
                          key={tk?.stakeEntry?.pubkey.toBase58()}
                          className="mx-auto"
                        >
                          <div className="relative w-44 md:w-auto 2xl:w-48">
                            <label
                              htmlFor={tk?.stakeEntry?.pubkey.toBase58()}
                              className="relative"
                            >
                              <div
                                className="relative cursor-pointer rounded-xl"
                                onClick={() => selectStakedToken(tk)}
                                style={{
                                  boxShadow: isStakedTokenSelected(tk)
                                    ? `0px 0px 20px ${stakePoolMetadata?.colors?.secondary}`
                                    : '',
                                }}
                              >
                                {(loadingUnstake || loadingClaimRewards) &&
                                  (isStakedTokenSelected(tk) ||
                                    singleTokenAction ===
                                      tk.stakeEntry?.parsed.originalMint.toString()) && (
                                    <div>
                                      <div className="absolute top-0 left-0 z-10 flex h-full w-full justify-center rounded-lg bg-black bg-opacity-80 align-middle text-white">
                                        <div className="mx-auto flex items-center justify-center">
                                          <span className="mr-2">
                                            <LoadingSpinner height="20px" />
                                          </span>
                                          {loadingUnstake
                                            ? 'Unstaking token...'
                                            : 'Claiming rewards...'}
                                        </div>
                                      </div>
                                    </div>
                                  )}
                                {tk.stakeEntry?.parsed.lastStaker.toString() !==
                                  wallet.publicKey?.toString() && (
                                  <div>
                                    <div className="absolute top-0 left-0 z-10 flex h-full w-full justify-center rounded-xl bg-black bg-opacity-80  align-middle text-white">
                                      <div className="mx-auto flex flex-col items-center justify-center">
                                        <div>Owned by</div>
                                        <DisplayAddress
                                          dark
                                          connection={connection}
                                          address={
                                            tk.stakeEntry?.parsed.lastStaker
                                          }
                                        />
                                      </div>
                                    </div>
                                  </div>
                                )}
                                <QuickActions
                                  receiptType={receiptType}
                                  stakedTokenData={tk}
                                  showFungibleTokens={showFungibleTokens}
                                  setStakedSelected={setStakedSelected}
                                  setUnstakedSelected={setUnstakedSelected}
                                  setLoadingStake={setLoadingStake}
                                  setLoadingUnstake={setLoadingUnstake}
                                  setLoadingClaimRewards={
                                    setLoadingClaimRewards
                                  }
                                  setSingleTokenAction={setSingleTokenAction}
                                  selectUnstakedToken={selectUnstakedToken}
                                  selectStakedToken={selectStakedToken}
                                />
                                <img
                                  className="mx-auto mt-4 rounded-t-xl bg-white bg-opacity-5 object-contain md:h-40 md:w-40 2xl:h-48 2xl:w-48"
                                  src={
                                    tk.metadata?.data.image ||
                                    tk.tokenListData?.logoURI
                                  }
                                  alt={
                                    tk.metadata?.data.name ||
                                    tk.tokenListData?.name
                                  }
                                />
                                <div
                                  className={`flex-col rounded-b-xl p-2 ${
                                    stakePoolMetadata?.colors?.fontColor
                                      ? `text-[${stakePoolMetadata?.colors?.fontColor}]`
                                      : 'text-gray-200'
                                  } ${
                                    stakePoolMetadata?.colors?.backgroundSecondary
                                      ? `bg-[${stakePoolMetadata?.colors?.backgroundSecondary}]`
                                      : 'bg-white bg-opacity-10'
                                  }`}
                                  style={{
                                    background:
                                      stakePoolMetadata?.colors
                                        ?.backgroundSecondary,
                                  }}
                                >
                                  <div className="truncate font-semibold">
                                    {tk.metadata?.data.name ||
                                      tk.tokenListData?.symbol}
                                  </div>
                                  
                                </div>
                                {isStakedTokenSelected(tk) && (
                                  <div
                                    className={`absolute top-2 left-2`}
                                    style={{
                                      height: '10px',
                                      width: '10px',
                                      backgroundColor:
                                        stakePoolMetadata?.colors?.primary ||
                                        'white',
                                      borderRadius: '50%',
                                      display: 'inline-block',
                                    }}
                                  />
                                )}
                              </div>
                            </label>
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </div>
            <div className="mt-2 flex flex-row-reverse flex-wrap justify-between gap-5">
              <div className="flex gap-5">
                <MouseoverTooltip
                  title={'Unstake will automatically claim reward for you.'}
                >
                  <button
                    onClick={() => {
                      if (stakedSelected.length === 0) {
                        notify({
                          message: `No tokens selected`,
                          type: 'error',
                        })
                      } else {
                        handleUnstake()
                      }
                    }}
                    style={{
                      background:
                        stakePoolMetadata?.colors?.secondary ||
                        defaultSecondaryColor,
                      color:
                        stakePoolMetadata?.colors?.fontColorSecondary ||
                        stakePoolMetadata?.colors?.fontColor,
                    }}
                    className="my-auto flex rounded-md px-4 py-2 hover:scale-[1.03]"
                  >
                    <span className="mr-1 inline-block">
                      {loadingUnstake && (
                        <LoadingSpinner
                          fill={
                            stakePoolMetadata?.colors?.fontColor
                              ? stakePoolMetadata?.colors?.fontColor
                              : '#FFF'
                          }
                          height="20px"
                        />
                      )}
                    </span>
                    <span className="my-auto">
                      Unstake ({stakedSelected.length})
                    </span>
                  </button>
                </MouseoverTooltip>
                <MouseoverTooltip title="Attempt to unstake all tokens at once">
                  <button
                    onClick={() => {
                      setStakedSelected(stakedTokenDatas.data || [])
                      handleUnstake(true)
                    }}
                    style={{
                      background:
                        stakePoolMetadata?.colors?.secondary ||
                        defaultSecondaryColor,
                      color:
                        stakePoolMetadata?.colors?.fontColorSecondary ||
                        stakePoolMetadata?.colors?.fontColor,
                    }}
                    className="my-auto flex cursor-pointer rounded-md px-4 py-2 hover:scale-[1.03]"
                  >
                    <span className="mr-1 inline-block">
                      {loadingUnstake && (
                        <LoadingSpinner
                          fill={
                            stakePoolMetadata?.colors?.fontColor
                              ? stakePoolMetadata?.colors?.fontColor
                              : '#FFF'
                          }
                          height="20px"
                        />
                      )}
                    </span>
                    <span className="my-auto">Unstake All</span>
                  </button>
                </MouseoverTooltip>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Home
