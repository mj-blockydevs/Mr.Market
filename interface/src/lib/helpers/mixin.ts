// @ts-nocheck
import axios from "axios";
import { get } from "svelte/store";
import { mixinConnected } from "$lib/stores/home";
import { buildMixinOneSafePaymentUri, hashMembers } from "@mixin.dev/mixin-node-sdk";
import { decodeSymbolToAssetID } from "$lib/helpers/utils";
import { topAssetsCache, user, userAssets } from "$lib/stores/wallet";
import { AppURL, BOT_ID, BTC_UUID, MIXIN_API_BASE_URL } from "$lib/helpers/constants";
import { GenerateSpotMemo } from "./memo";

export const isIOS = () => {
  const ua = window?.navigator?.userAgent;
  const check = function (pattern: RegExp): boolean {
    return (pattern).test(ua);
  }
  return check(/\(i[^;]+;( U;)? CPU.+Mac OS X/i)
}

export const isMixin = () => {
  const ios = isIOS()
  return !!(ios
    ? window?.webkit?.messageHandlers?.MixinContext
    : window?.MixinContext && typeof window?.MixinContext?.getContext === 'function');
}

export const getMixinContext = () => {
  const ios = isIOS()
  return ios
    ? window?.webkit?.messageHandlers?.MixinContext
    : window?.MixinContext;
}

export const mixinShare = (url: string, title: string, description: string, icon_url: string) => {
  const data = {
    action: `${AppURL}${url}`,
    app_id: BOT_ID,
    description,
    icon_url,
    title,
  };
  window.open(`mixin://send?category=app_card&data=${encodeURIComponent(btoa(JSON.stringify(data)))}`)
}

export const mixinPay = ({ asset_id, amount, memo, trace_id }: { asset_id: string, amount: string, memo: string, trace_id: string }) => {
  window.open(buildMixinOneSafePaymentUri({
    uuid: BOT_ID,
    asset: asset_id,
    amount: amount,
    memo: memo,
    trace: trace_id,
  }))
}

export const mixinUserMe = async (token: string) => {
  const config = {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  };
  const result = await axios
    .get(MIXIN_API_BASE_URL + "/me", config);
  return result.data ? result.data.data : {};
}

export const mixinSafeAllOutputs = async (members: string[], token: string) => {
  const config = {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  };

  const result = await axios
    .get(MIXIN_API_BASE_URL + `/safe/outputs?members=${hashMembers(members)}&threshold=1&offset=0&limit=1000&&order=ASC`, config);
  return result.data ? result.data.data : {};
}

export const mixinSafeOutputs = async (members: string[], token: string, spent: boolean = false) => {
  const config = {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  };

  const result = await axios
    .get(MIXIN_API_BASE_URL + `/safe/outputs?members=${hashMembers(members)}&threshold=1&offset=0&limit=1000&state=${spent ? "spent" : "unspent"}&order=ASC`, config);
  return result.data ? result.data.data : {};
}

export const mixinTopAssets = async () => {
  const result = await axios
    .get(MIXIN_API_BASE_URL + `/network/assets/top`);

  return result.data ? result.data.data : {};
}

export const mixinAsset = async (asset_id: string) => {
  const result = await axios
    .get(MIXIN_API_BASE_URL + `/network/assets/${asset_id}`);

  return result.data ? result.data.data : {};
}

export const mixinSafeAsset = async (asset_id: string, token: string) => {
  const config = {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  };

  const result = await axios
    .get(MIXIN_API_BASE_URL + `/safe/assets/${asset_id}`, config);
  return result.data ? result.data.data : {};
}

async function fetchTopAssetsCache() {
  const topAssets = await mixinTopAssets();
  const topCache = get(topAssetsCache)
  topAssets.forEach(asset => {
    topCache[asset.asset_id] = asset;
  });
  topAssetsCache.set(topCache)
  return topCache
}

async function getAssetDetails(asset_id: string, topAssetsCache: unknown) {
  if (topAssetsCache && topAssetsCache[asset_id]) {
    return topAssetsCache[asset_id];
  } else {
    // If not in cache, fetch the asset details
    return await mixinAsset(asset_id);
  }
}

// Step 2: Group UTXOs by asset_id and sum the amounts
export function groupAndSumUTXOs(outputs) {
  const balances = outputs.reduce((acc, output) => {
    const { asset_id, amount } = output;
    if (!acc[asset_id]) {
      acc[asset_id] = { balance: 0, asset_id };
    }
    acc[asset_id].balance += parseFloat(amount);
    return acc;
  }, {});
  return balances;
}

export async function calculateAndSortUSDBalances(balances, topAssetsCache) {
  for (const asset_id in balances) {
    const assetDetails = await getAssetDetails(asset_id, topAssetsCache);
    balances[asset_id].usdBalance = balances[asset_id].balance * parseFloat(assetDetails.price_usd);
    balances[asset_id].details = assetDetails;
  }

  // Sort the balances by USD balance
  const sortedBalancesArray = Object.values(balances).sort((a, b) => b.usdBalance - a.usdBalance);
  return sortedBalancesArray; // You can keep it as an array since it's already sorted
}

// Step 5: Calculate total USD balance
export function calculateTotalUSDBalance(balances) {
  return Object.values(balances).reduce((acc, { usdBalance }) => acc + usdBalance, 0);
}

// Step 6: Calculate total BTC balance
async function calculateTotalBTCBalance(totalUSDBalance) {
  const btcDetails = await getAssetDetails(BTC_UUID, get(topAssetsCache))
  return totalUSDBalance / parseFloat(btcDetails.price_usd);
}

const getUserBalances = async (user_id: string, token: string) => {
  if (isMixin) {
    // TODO: implement get asset list from mixin webview context
  }
  const topAssetsCache = await fetchTopAssetsCache();
  const outputs = await mixinSafeOutputs([user_id], token)
  // console.log(outputs)
  let balances = groupAndSumUTXOs(outputs);
  balances = await calculateAndSortUSDBalances(balances, topAssetsCache);
  const totalUSDBalance = calculateTotalUSDBalance(balances);
  const totalBTCBalance = await calculateTotalBTCBalance(totalUSDBalance);
  userAssets.set({ balances, totalUSDBalance, totalBTCBalance })
  return { balances, totalUSDBalance, totalBTCBalance }
}

export const AfterMixinOauth = async (token: string) => {
  const data = await mixinUserMe(token)
  if (!data) {
    console.log('!UserMe, remove mixin-oauth')
    localStorage.removeItem('mixin-oauth')
    return
  }
  if (data.full_name === '') {
    console.log('!UserMeError, remove mixin-oauth')
    localStorage.removeItem('mixin-oauth')
    return
  }
  user.set(data)
  mixinConnected.set(true)
  localStorage.setItem("mixin-oauth", JSON.stringify(token))
  getUserBalances(data.user_id, token)
}

export const MixinDisconnect = () => {
  user.set({})
  mixinConnected.set(false)
  localStorage.removeItem("mixin-oauth")
}

export const SpotPay = ({ exchange, symbol, limit, price, buy, amount, trace }: { exchange: string, symbol: string, limit: boolean, price: string, buy: boolean, amount: string, trace: string }) => {
  if (!exchange || !symbol || !amount || !trace) {
    console.error('Invalid input parameters');
    return;
  }
  if (!price) {
    price = '0'
  }
  const { firstAssetID, secondAssetID } = decodeSymbolToAssetID(symbol)
  if (!firstAssetID || !secondAssetID) {
    console.error('Failed to get asset id because invaild symbol submmited')
    return;
  }
  const memo = GenerateSpotMemo({ limit, buy, symbol, price, exchange });
  if (buy) {
    return mixinPay({asset_id:secondAssetID, amount, memo, trace_id:trace});
  }
  return mixinPay({asset_id:firstAssetID, amount, memo, trace_id:trace});
}