import { tryPublicKey } from '@cardinal/namespaces-components'
import { stakePoolMetadatas } from 'api/mapping'
import { useRouter } from 'next/router'

export const useStakePoolId = () => {
  // const {
  //   query: { stakePoolId },
  // } = useRouter()
  const stakePoolId = '3EyzFXhsVXApzPHhz9QcBaQryGicQxzeN5YZ43KRVDba'//'8ofNk2sg1AfkqpFvaW768AqfE2JRAuTueBZahBEbbDwT'
  const nameMapping = stakePoolMetadatas.find((p) => p.name === stakePoolId)
  const addressMapping = stakePoolMetadatas.find(
    (p) => p.stakePoolAddress.toString() === stakePoolId
  )
  const publicKey =
    nameMapping?.stakePoolAddress ||
    addressMapping?.stakePoolAddress ||
    tryPublicKey(stakePoolId)

  return publicKey
}
