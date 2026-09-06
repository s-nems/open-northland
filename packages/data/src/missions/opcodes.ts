import type { MissionArgs, MissionParamKind } from './params.js';

/** One opcode: its name, then its parameter kinds in the order the engine reads them. */
export type OpcodeRow = readonly [name: string, ...params: readonly MissionParamKind[]];

/**
 * The goal table, indexed as the engine indexes it. Names and parameter kinds are a reading of the
 * original cross-checked against the goal reference shipped in the installation's `Tools/` folder,
 * which names the same 63 goals and gives every one an example of the same arity.
 * `docs/formats/MISSIONS.md` records what each goal tests.
 */
export const MISSION_GOALS = [
  ['True'],
  ['BuildVehicles', 'player', 'vehicleTypeName', 'amount', 'vehicleId'],
  ['BuildHumans', 'player', 'jobName', 'amount', 'humanId'],
  ['BuildHouses', 'player', 'houseTypeName', 'amount', 'objectId'],
  ['GoodsInVehicles', 'vehicleId', 'goodName', 'amount'],
  ['GoodsInHouses', 'objectId', 'goodName', 'amount'],
  ['GoodsGlobal', 'player', 'goodName', 'amount'],
  ['FindPos', 'player', 'point'],
  ['FindHumans', 'player', 'humanId'],
  ['FindVehicles', 'player', 'vehicleId'],
  ['FindHouses', 'player', 'objectId'],
  ['FindPosByHumans', 'humanId', 'point', 'range'],
  ['FindPosByVehicles', 'vehicleId', 'point', 'range'],
  ['FindHumansByHumans', 'humanId', 'otherHumanId', 'range'],
  ['FindHumansByVehicles', 'vehicleId', 'humanId', 'range'],
  ['FindVehiclesByVehicles', 'vehicleId', 'otherVehicleId', 'range'],
  ['FindHousesByHumans', 'humanId', 'objectId', 'range'],
  ['FindHousesByVehicles', 'vehicleId', 'objectId', 'range'],
  ['HumansDied', 'humanId'],
  ['VehiclesDied', 'vehicleId'],
  ['HousesDied', 'objectId'],
  ['PlayerDied', 'player'],
  ['FindPosByPlayersMapMoveable', 'player', 'point', 'range'],
  ['BuildHouseOnContinent', 'player', 'point', 'houseTypeName'],
  ['DiplomacyState', 'player', 'otherPlayer', 'diplomacyName'],
  ['HumansWithHome', 'player', 'amount'],
  ['NumberOfSoldiers', 'player', 'amount'],
  ['DetectGuide', 'player', 'point', 'range'],
  ['TimeGone', 'seconds'],
  ['CheckMission', 'missionIndex'],
  ['PayTribute', 'tributeSlot'],
  ['Population', 'player', 'amount'],
  ['PlayerSeen', 'player', 'otherPlayer'],
  ['IsHumanInVehicle', 'humanId', 'vehicleId'],
  ['FindHumansByPlayersMM', 'humanId', 'player', 'range'],
  ['SoldiersDied', 'player', 'amount'],
  ['AnimalsDied', 'objectId'],
  ['PlayerAttackedByPlayer', 'otherPlayer', 'player'],
  ['JobEnabled', 'player', 'tribeName', 'jobName'],
  ['GoodProduceable', 'player', 'tribeName', 'goodName'],
  ['NumberOfHumansDied', 'player', 'amount'],
  ['FindAnimals', 'player', 'objectId'],
  ['NumberOfGoodsTraded', 'player', 'otherPlayer', 'amount'],
  ['HumanAttachedToWorkHouse', 'player', 'jobName', 'amount'],
  ['CheckNumberOfWildAnimals', 'tribeName', 'amount'],
  ['RandomTimeGone', 'seconds'],
  ['IfMissionIsActive', 'missionIndex'],
  ['NumberOfAnimals', 'player', 'tribeName', 'amount'],
  ['NumberOfHumansKilled', 'player', 'amount'],
  ['HumanIsOnContinent', 'humanId', 'point'],
  ['IsMissionDone', 'missionIndex'],
  ['NumberOfSoldiersNearPos', 'player', 'point', 'range', 'amount'],
  ['NumberOfCivilainsNearPos', 'player', 'point', 'range', 'amount'],
  ['ChestNearPos', 'point', 'range'],
  ['NumberOfGoodsInArea', 'player', 'goodName', 'amount', 'point', 'range'],
  ['NumberOfHousesInArea', 'player', 'houseTypeName', 'amount', 'point', 'range'],
  ['NumberOfGoodsInHousesInArea', 'player', 'goodName', 'amount', 'point', 'range'],
  ['NumberOfVehiclesInArea', 'player', 'vehicleTypeName', 'amount', 'point', 'range'],
  ['NumberOfAnimalsInArea', 'player', 'tribeName', 'amount', 'point', 'range'],
  ['CheckHumanJob', 'humanId', 'jobName'],
  ['NumberOfGoodsInVehiclesInArea', 'player', 'vehicleTypeName', 'goodName', 'amount', 'point', 'range'],
  ['IsAnyLandscapeOnPoint', 'point'],
  ['IsLandscapePlayer10ConstructionSignOnPoint', 'point'],
] as const satisfies readonly OpcodeRow[];

/**
 * The result table, same conventions. The reference lists 102 of the 103 and matches every arity;
 * `SetMapAreaMarker` (101) is absent there and no map uses it. Two names carry the engine's own
 * spelling, spaces included.
 */
export const MISSION_RESULTS = [
  ['None'],
  ['SetHuman', 'player', 'tribeName', 'jobName', 'point', 'humanId', 'behaviourFlags'],
  ['SetVehicle', 'player', 'tribeName', 'vehicleTypeName', 'point', 'vehicleId', 'captainFlag'],
  ['SetHouse', 'player', 'houseName', 'level', 'siteFlag', 'point', 'objectId'],
  ['SetLandscape', 'point', 'landscapeName', 'level', 'flag'],
  ['RemoveHumans', 'humanId'],
  ['RemoveVehicles', 'vehicleId'],
  ['RemoveHouses', 'objectId'],
  ['RemoveLandscape', 'point'],
  ['PlayCutscene', 'cutsceneId', 'replayFlag'],
  ['ActivateMission', 'missionIndex'],
  ['DeactivateMission', 'missionIndex'],
  ['MissionWon', 'player'],
  ['MissionFailed', 'player'],
  ['AllowMap', 'campaignId', 'mapId'],
  ['CloseMap', 'campaignId', 'mapId'],
  ['ExploreArea', 'player', 'point', 'range'],
  ['Exit'],
  ['SetExternalFlag', 'player', 'externalFlag', 'flag'],
  ['SetDiplomacy', 'player', 'otherPlayer', 'diplomacyName'],
  ['SetVisible', 'missionIndex', 'flag'],
  ['ChangeHumanPlayerId', 'humanId', 'player'],
  ['ChangePlayerPlayerId', 'player', 'otherPlayer'],
  ['SendHuman', 'humanId', 'point'],
  ['SendVehicle', 'vehicleId', 'point'],
  ['DockVehicle', 'vehicleId', 'point'],
  ['PlaySound', 'soundId', 'point'],
  ['CreateTribute', 'tributeSlot', 'player', 'otherPlayer', 'stringId'],
  ['AddTributeGoods', 'tributeSlot', 'goodName', 'amount'],
  ['AllowJob', 'player', 'tribeName', 'jobName'],
  ['AllowHouse', 'player', 'tribeName', 'houseTypeName'],
  ['AddGoodsToHouses', 'objectId', 'goodName', 'amount'],
  ['StartSubMission', 'campaignId', 'mapId'],
  ['EndSubMission'],
  ['ChangeVehiclesPlayerId', 'vehicleId', 'player'],
  ['ChangeHousesPlayerId', 'objectId', 'player'],
  ['SetImportHumanFlag', 'humanId', 'flag'],
  ['EnableJob', 'player', 'tribeName', 'jobName'],
  ['EnableHouse', 'player', 'tribeName', 'houseTypeName'],
  ['DisableAll'],
  ['AddGoodsToVehicle', 'vehicleId', 'goodName', 'amount'],
  ['AddGoodsToAnyStock', 'player', 'goodName', 'amount'],
  ['AllowGood', 'player', 'tribeName', 'goodName'],
  ['EnableGood', 'player', 'tribeName', 'goodName'],
  ['ChangePlayerIdInArea', 'player', 'otherPlayer', 'point', 'range'],
  ['SetDiplomacyNotChangeableFlag', 'player', 'otherPlayer', 'flag'],
  ['RemoveFXWaveLandscapeInArea', 'point', 'range'],
  ['1 Open/0 CloseWallGate', 'player', 'point', 'flag'],
  ['Mission quit and play video', 'amount'],
  ['SetPlayerBehaviourFlag', 'player', 'amount', 'flag'],
  ['SetHumanBehaviourFlag', 'humanId', 'amount', 'flag'],
  ['SetRandomChestOnRandomPos', 'amount'],
  ['RemoveHumansNearPos', 'point', 'range'],
  ['StopHumanByPlayerId', 'player'],
  ['SetAnimal', 'player', 'tribeName', 'jobName', 'point', 'objectId', 'behaviourFlags'],
  ['RemoveAnimals', 'objectId'],
  ['ChangeHumanObjectIdInArea', 'player', 'point', 'range', 'humanId'],
  ['HealHumansInArea', 'point', 'range'],
  ['ClearTribute', 'tributeSlot'],
  ['SetGuiMarker', 'objectId', 'point'],
  ['SetHumanName', 'humanId', 'stringId'],
  ['SetWeather', 'point', 'range', 'flag', 'amount'],
  ['StartEarthQuake', 'seconds'],
  ['SelectHuman', 'humanId', 'flag'],
  ['AddGoodsToMapArea', 'goodName', 'amount', 'point', 'range', 'flag', 'player'],
  ['RemoveGoodsFromMapArea', 'goodName', 'amount', 'point', 'range', 'flag', 'player'],
  ['ChangeMissionIdOfHumanInRange', 'player', 'humanId', 'point', 'range'],
  ['ChangeMissionIdOfPlayer', 'player', 'humanId'],
  ['SetVertexColor', 'point', 'range', 'amount'],
  ['RemoveLandscapesInArea', 'point', 'range'],
  ['MoveUnitsInArea', 'player', 'point', 'range', 'index', 'extra'],
  ['SetHouseExtensionLevel', 'objectId', 'amount'],
  ['InfoClear', 'player', 'index'],
  ['InfoShowString', 'player', 'index', 'stringId'],
  ['InfoCountGoodsInArea', 'player', 'index', 'stringId', 'goodName', 'point', 'range', 'extra'],
  ['InfoCountHousesInArea', 'player', 'index', 'stringId', 'houseTypeName', 'point', 'range', 'extra'],
  ['InfoCountHumenInArea', 'player', 'index', 'stringId', 'point', 'range', 'extra'],
  ['InfoCountSoldiersInArea', 'player', 'index', 'stringId', 'point', 'range', 'extra'],
  ['InfoCountAnimalsInArea', 'player', 'index', 'stringId', 'tribeName', 'point', 'range', 'extra'],
  ['RemoveFXSmokeLandscapeInArea', 'point', 'range'],
  ['ChangeAnimalPlayerIdInArea', 'player', 'tribeName', 'point', 'range', 'amount', 'otherPlayer'],
  ['RemoveHPsOfHousesInArea', 'player', 'point', 'range', 'amount'],
  ['RemoveBlockerLandscapeInArea', 'point', 'range'],
  ['RemoveFX1LandscapeInArea', 'point', 'range'],
  ['RemoveFX2LandscapeInArea', 'point', 'range'],
  ['SetCameraPosition', 'point'],
  ['SetHumanX', 'player', 'tribeName', 'jobName', 'point', 'humanId', 'behaviourFlags', 'amount'],
  ['RemoveHPsOfHousesInAreaX', 'player', 'point', 'range', 'amount', 'objectId'],
  ['SetHouseOverlayState', 'objectId', 'extra', 'flag'],
  ['AttachHumanToVehicle', 'humanId', 'vehicleId'],
  ['DetachHumanFromVehicle', 'humanId'],
  ['SetHouseBuildForbiddenArea', 'point', 'range', 'flag'],
  ['MoveHuman', 'humanId', 'point'],
  ['SetHouseBehaviourFlag', 'objectId', 'index', 'flag'],
  ['ChangeMissionIdOfVehiclesInRange', 'player', 'vehicleId', 'point', 'range'],
  ['RemoveVehiclesWithMissionId', 'vehicleId', 'flag'],
  ['SetImportLandscapeMarker', 'point', 'flag'],
  ['SetVertexColorOnLand', 'point', 'range', 'amount'],
  ['ChangeMissionIdOfPlayersVehiclesOnContinent', 'player', 'point', 'vehicleId'],
  ['ChangeMissionIdOfVehicles', 'vehicleId', 'index'],
  ['SetRandomChestOnPosition', 'amount', 'point'],
  ['SetMapAreaMarker', 'point', 'range', 'flag', 'index'],
  ['SetMapAreaMarkerMagic', 'point', 'range', 'flag', 'index'],
] as const satisfies readonly OpcodeRow[];

/** An unmatched opcode name resolves to index 0: goal `True`, result `None`. */
export const UNKNOWN_OPCODE_INDEX = 0;

type OpcodeRows = readonly OpcodeRow[];

type NameOf<R extends OpcodeRows> = R[number][0];
type RowOf<R extends OpcodeRows, N extends NameOf<R>> = Extract<
  R[number],
  readonly [N, ...MissionParamKind[]]
>;
type ParamsOf<R extends OpcodeRow> = R extends readonly [string, ...infer P extends MissionParamKind[]]
  ? P
  : never;

/** The decoded form of one table: an opcode-tagged union carrying that opcode's own parameters. */
export type Decoded<R extends OpcodeRows> = {
  [N in NameOf<R>]: { readonly opcode: N } & MissionArgs<ParamsOf<RowOf<R, N>>>;
}[NameOf<R>];

export type MissionGoalName = NameOf<typeof MISSION_GOALS>;
export type MissionResultName = NameOf<typeof MISSION_RESULTS>;
export type MissionGoal = Decoded<typeof MISSION_GOALS>;
export type MissionResult = Decoded<typeof MISSION_RESULTS>;
