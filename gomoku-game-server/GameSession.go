/*
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: MIT-0
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this
 * software and associated documentation files (the "Software"), to deal in the Software
 * without restriction, including without limitation the rights to use, copy, modify,
 * merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
 * INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
 * PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
 * HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
 * OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
 * SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

package main

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"math"
	"strconv"
)

type StoneType byte

const (
	STONE_NONE  StoneType = 0
	STONE_WHITE StoneType = 1
	STONE_BLACK StoneType = 2
)

type GameStatus byte

const (
	GS_NOT_STARTED         GameStatus = 0
	GS_STARTED             GameStatus = 1
	GS_GAME_OVER_BLACK_WIN GameStatus = 2
	GS_GAME_OVER_WHITE_WIN GameStatus = 3
)

const BOARD_SIZE = 19

const MAX_SESSION_LEN = 128
const MAX_STRING_LEN = 64
const MAX_PLAYER_PER_GAME = 2

type PacketTypes uint16

const (
	PKT_NONE PacketTypes = 0

	/// Client and GameServer
	PKT_CS_START PacketTypes = 1
	PKT_SC_START PacketTypes = 2

	PKT_CS_PUT_STONE    PacketTypes = 21
	PKT_SC_BOARD_STATUS PacketTypes = 22

	PKT_CS_EXIT PacketTypes = 31

	PKT_CS_PING PacketTypes = 41 // Client Ping message to Keep connected when global accelerator is used.

	/// Client and MatchMaker
	PKT_CM_MATCH_REQUEST PacketTypes = 101
	PKT_MC_WAIT          PacketTypes = 102
	PKT_MC_MATCH_RESULT  PacketTypes = 103

	PKT_MAX PacketTypes = 1024
)

type BoardStatus struct {
	mBoardMatrix [BOARD_SIZE][BOARD_SIZE]StoneType
}

type GameSession struct {
	mPlayerBlack *PlayerSession
	mPlayerWhite *PlayerSession

	mGameStatus  GameStatus
	mBoardStatus [][]byte // BoardStatus. Will be initialized to [BOARD_SIZE][BOARD_SIZE]
	mCurrentTurn StoneType

	mGameLiftManager *GameLiftManager
}

func (gs *GameSession) PlayerEnter(psess *PlayerSession) {
	// FastSpinlockGuard lock(mGameSessionLock);

	if gs.mGameStatus != GS_NOT_STARTED {
		myLogger.Print("[PlayerEnter Denied] Game has already started.\n", psess.GetPlayerSessionId())
		return
	}
	// Make first connected Player as Black one.
	if gs.mPlayerBlack != nil {
		/// Game Ready!
		gs.mPlayerWhite = psess
		gs.mGameStatus = GS_STARTED
		gs.mCurrentTurn = STONE_BLACK
		myLogger.Print("[PlayerEnter] PlayerWhite")
	} else {
		gs.mPlayerBlack = psess
		myLogger.Print("[PlayerEnter] PlayerBlack")
	}
}

func (gs *GameSession) PlayerLeave(psess *PlayerSession) {
	// FastSpinlockGuard lock(mGameSessionLock);

	if gs.mGameStatus == GS_STARTED {
		/// giveup
		if psess == gs.mPlayerBlack {
			gs.mGameStatus = GS_GAME_OVER_WHITE_WIN
			gs.SendGameResult(false)
		} else {
			gs.mGameStatus = GS_GAME_OVER_BLACK_WIN
			gs.SendGameResult(true)
		}

		gs.BroadcastGameStatus()
	}

	/* doesn't have to release memory with go
	if psess == gs.mPlayerBlack {
		gs.mPlayerBlack.reset()
	} else {
		gs.mPlayerWhite.reset()
	}
	*/
}

func (gs *GameSession) PutStone(psess *PlayerSession, x int, y int) {
	if x < 0 || x >= BOARD_SIZE || y < 0 || y >= BOARD_SIZE {
		myLogger.Print("[PutStone Denied] out of range\n", psess.GetPlayerSessionId())
		return
	}

	if gs.mGameStatus != GS_STARTED {
		myLogger.Print("[PutStone Denied] Not started game\n", psess.GetPlayerSessionId())
		return
	}

	// FastSpinlockGuard lock(mGameSessionLock);

	var isBlack bool = (psess == gs.mPlayerBlack)

	if isBlack && gs.mCurrentTurn != STONE_BLACK {
		myLogger.Print("[PutStone Denied] Turn mismatch\n", psess.GetPlayerSessionId())
		return
	}

	if !isBlack && gs.mCurrentTurn != STONE_WHITE {
		myLogger.Print("[PutStone Denied] Turn mismatch\n", psess.GetPlayerSessionId())
		return
	}

	if gs.mBoardStatus[x][y] != byte(STONE_NONE) {
		myLogger.Print("[PutStone Denied] wrong position\n", psess.GetPlayerSessionId())
		return
	}

	var st StoneType
	if isBlack == true {
		st = STONE_BLACK
		myLogger.Printf("PutStone from Black xpos:%d, ypos:%d", x, y)
	} else {
		st = STONE_WHITE
		myLogger.Printf("PutStone from White xpos:%d, ypos:%d", x, y)
	}

	gs.mBoardStatus[x][y] = byte(st)

	/// Win check...
	if gs.IsWin(st) {
		if isBlack {
			gs.mGameStatus = GS_GAME_OVER_BLACK_WIN
		} else {
			gs.mGameStatus = GS_GAME_OVER_WHITE_WIN
		}
		gs.SendGameResult(isBlack)
	}

	if isBlack {
		gs.mCurrentTurn = STONE_WHITE
	} else {
		gs.mCurrentTurn = STONE_BLACK
	}

	gs.BroadcastGameStatus()
}

func (gs *GameSession) BroadcastGameStart() {
	var size, ptype uint16
	// GameStartBroadcast message structure
	// mSize (2byte)
	// mType (2byte)
	// mFirstPlayerId (MAX_SESSION_LEN byte)
	// mOpponentName (MAX_STRING_LEN byte)
	var outPacketToBlack, outPacketToWhite [2 + 2 + MAX_SESSION_LEN + MAX_STRING_LEN]byte

	if gs.mGameStatus != GS_STARTED {
		myLogger.Fatal("BroadcastGameStart Error Not GS_STARTED")
	}

	fmt.Println("BroadcastGameStart() gs.mPlayerBlack: ", gs.mPlayerBlack)

	size = 2 + 2 + MAX_SESSION_LEN + MAX_STRING_LEN
	ptype = uint16(PKT_SC_START)

	binary.LittleEndian.PutUint16(outPacketToBlack[0:], size)
	binary.LittleEndian.PutUint16(outPacketToBlack[2:], ptype)
	copy(outPacketToBlack[4:], gs.mPlayerBlack.GetPlayerSessionId())
	copy(outPacketToBlack[(4+MAX_SESSION_LEN):], gs.mPlayerWhite.GetPlayerName())

	if false == gs.mPlayerBlack.PostSend(outPacketToBlack[0:size], int(size)) {
		gs.mPlayerBlack.Disconnect(DR_SENDBUFFER_ERROR)
	}

	binary.LittleEndian.PutUint16(outPacketToWhite[0:], size)
	binary.LittleEndian.PutUint16(outPacketToWhite[2:], ptype)
	copy(outPacketToWhite[4:], gs.mPlayerBlack.GetPlayerSessionId())
	copy(outPacketToWhite[(4+MAX_SESSION_LEN):], gs.mPlayerBlack.GetPlayerName())

	if false == gs.mPlayerWhite.PostSend(outPacketToWhite[0:2+2+MAX_SESSION_LEN+MAX_STRING_LEN], int(size)) {
		gs.mPlayerWhite.Disconnect(DR_SENDBUFFER_ERROR)
	}

	// Initialize BoardStatus
	gs.mBoardStatus = make([][]byte, BOARD_SIZE)
	for i := 0; i < BOARD_SIZE; i++ {
		gs.mBoardStatus[i] = make([]byte, BOARD_SIZE)
	}
}

func (gs *GameSession) BroadcastGameStatus() {
	var size, ptype uint16

	// BroadcastGameStatus message structure
	// mSize (2byte)
	// mType (2byte)
	// BoardStatus (BOARD_SIZE * BOARD_SIZE byte)
	// GameStatus (1byte)
	// StoneType (1byte)
	//var outPacket []byte
	var outPacket [2 + 2 + (BOARD_SIZE * BOARD_SIZE) + 1 + 1]byte

	fmt.Println("BroadcastGameStatus()")

	size = 2 + 2 + (BOARD_SIZE * BOARD_SIZE) + 1 + 1
	ptype = uint16(PKT_SC_BOARD_STATUS)

	binary.LittleEndian.PutUint16(outPacket[0:], size)
	binary.LittleEndian.PutUint16(outPacket[2:], ptype)
	copy(outPacket[4:], bytes.Join(gs.mBoardStatus, nil))
	outPacket[(4 + BOARD_SIZE*BOARD_SIZE)] = byte(gs.mGameStatus)
	outPacket[(4+BOARD_SIZE*BOARD_SIZE)+1] = byte(gs.mCurrentTurn)

	if false == gs.mPlayerBlack.PostSend(outPacket[0:size], int(size)) {
		gs.mPlayerBlack.Disconnect(DR_SENDBUFFER_ERROR)
	}

	if false == gs.mPlayerWhite.PostSend(outPacket[0:size], int(size)) {
		gs.mPlayerWhite.Disconnect(DR_SENDBUFFER_ERROR)
	}
}

func (gs *GameSession) IsWin(st StoneType) bool {

	for l := 0; l < BOARD_SIZE; l++ {
		for i1 := 0; i1 < BOARD_SIZE; i1++ {
			if l < BOARD_SIZE-4 && gs.CheckLine(st, l, i1, 1, 0) {
				return true
			}

			if l < BOARD_SIZE-4 && i1 < BOARD_SIZE-4 && gs.CheckLine(st, l, i1, 1, 1) {
				return true
			}

			if i1 < BOARD_SIZE-4 && gs.CheckLine(st, l, i1, 0, 1) {
				return true
			}

			if l <= 3 || i1 >= BOARD_SIZE-4 || !gs.CheckLine(st, l, i1, -1, 1) {
				continue
			}

			return true
		}
	}

	return false
}

func (gs GameSession) CheckLine(st StoneType, i int, j int, l int, i1 int) bool {
	var j1 int = 0

	for {
		if gs.mBoardStatus[i+j1*l][j+j1*i1] != byte(st) {
			return false
		}
		j1++
		if j1 == 5 {
			break
		}
	}

	return true
}

func (gs *GameSession) CalcEloScore(myScore int, opponentScore int, win bool) int {
	var K int = 100
	var result float64
	var expected float64

	expected = 1 / (1 + math.Pow(10, (float64(myScore-opponentScore)/400)))
	if win {
		result = math.Round(float64(myScore) + float64(K)*(float64(1)-expected))
	} else {
		result = math.Round(float64(myScore) + float64(K)*(float64(0)-expected))
	}

	return int(result) - myScore
}

func (gs *GameSession) MakeResultJsonString(playerName string, scorediff int, windiff int, losediff int) string {
	var ss string

	ss = "{ \"PlayerName\" : \""
	ss += playerName
	ss += "\", \"WinDiff\" : "
	ss += strconv.Itoa(windiff)
	ss += ", \"LoseDiff\" : "
	ss += strconv.Itoa(losediff)
	ss += ", \"ScoreDiff\" : "
	ss += strconv.Itoa(scorediff)
	ss += " }"

	return ss

	/*
	   ss << "{ " << std::quoted("PlayerName") << " : " << std::quoted(playerName) << ", "
	       << std::quoted("WinDiff") << " : " << windiff << ", "
	       << std::quoted("LoseDiff") << " : " << losediff << ", "
	       << std::quoted("ScoreDiff") << " : " << scorediff << " }";

	   return ss.str();
	*/
}

func (gs *GameSession) SendGameResult(isBlackWin bool) {

	var blackJson, whiteJson string

	blackNew := gs.CalcEloScore(gs.mPlayerBlack.GetPlayerScore(), gs.mPlayerWhite.GetPlayerScore(), isBlackWin)
	whiteNew := gs.CalcEloScore(gs.mPlayerWhite.GetPlayerScore(), gs.mPlayerBlack.GetPlayerScore(), !isBlackWin)

	if isBlackWin {
		myLogger.Printf("[GAME OVER] Player %s Win!\n", gs.mPlayerBlack.mPlayerSessionId)

		blackJson = gs.MakeResultJsonString(gs.mPlayerBlack.mPlayerName, blackNew, 1, 0)
		whiteJson = gs.MakeResultJsonString(gs.mPlayerWhite.mPlayerName, whiteNew, 0, 1)
	} else {
		myLogger.Printf("[GAME OVER] Player %s Win!\n", gs.mPlayerWhite.mPlayerSessionId)

		blackJson = gs.MakeResultJsonString(gs.mPlayerBlack.mPlayerName, blackNew, 0, 1)
		whiteJson = gs.MakeResultJsonString(gs.mPlayerWhite.mPlayerName, whiteNew, 1, 0)
	}

	/// Send to SQS
	gs.mGameLiftManager.SendGameResultToSQS(blackJson, whiteJson)
}

func (gs *GameSession) IsEnd() bool {
	return gs.mGameStatus == GS_GAME_OVER_BLACK_WIN || gs.mGameStatus == GS_GAME_OVER_WHITE_WIN
}
