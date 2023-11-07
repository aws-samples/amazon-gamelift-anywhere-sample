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
	"fmt"
	"net"
	"sync"
)

type DisconnectReason int

const (
	DR_NONE             DisconnectReason = 0
	DR_ACTIVE           DisconnectReason = 1
	DR_ONCONNECT_ERROR  DisconnectReason = 2
	DR_IO_REQUEST_ERROR DisconnectReason = 3
	DR_COMPLETION_ERROR DisconnectReason = 4
	DR_SENDFLUSH_ERROR  DisconnectReason = 5
	DR_SENDBUFFER_ERROR DisconnectReason = 6
	DR_UNAUTH           DisconnectReason = 7
	DR_LOGOUT           DisconnectReason = 8
)

func (ps *PlayerSession) OnConnect(wg *sync.WaitGroup) bool {
	// In C++, called CreateIoCompletionPort with PlayerSession pointer as 'CompletionKey' argument
	// so that each session thread can retrive PlayerSession pointer when calling GetQueuedCompletionStatus in IOThread::DoIocpJob
	// Let's Start goroutine here with PlayerSession pointer as argument

	myLogger.Print("Session OnConnect() implement this")
	ps.mConnected++

	// Run go routine for communication with each player
	go DoIocpJob(ps.mConn, ps, wg)

	return true
}

func (ps *PlayerSession) Disconnect(dr DisconnectReason) {
	/*
		/// already disconnected or disconnecting...
		if (0 == InterlockedExchange(&mConnected, 0))
			return;
	*/

	myLogger.Printf("[DEBUG] Client Disconnected: Reason=%d %s\n", dr, ps.mClientAddr.String())

	err := ps.mConn.(*net.TCPConn).SetLinger(0)
	if err != nil {
		myLogger.Printf("Error when setting linger: %s", err)
	}

	ps.OnDisconnect(dr)
	ps.mConn.Close()
}

func (ps *PlayerSession) PreRecv() bool {
	return true
}

func (ps *PlayerSession) PostRecv() bool {
	return true
}

func (ps *PlayerSession) PostSend(data []byte, len int) bool {
	// let's not use circular buffer for now.  Send to network directly
	n, err := ps.mConn.Write(data)
	if n != len {
		fmt.Printf("Write error: %d != %d\n", n, len)
	}

	if err != nil {
		fmt.Println("Write error: ", err)
		return false
	}

	return true
}

func (ps *PlayerSession) FlushSend() bool {
	return true
}
func (ps *PlayerSession) SendCompletion(transferred int) {}
func (ps *PlayerSession) RecvCompletion(transferred int) {}
func (ps *PlayerSession) EchoBack()                      {}

type PlayerSession struct {
	mClientAddr net.Addr
	mConn       net.Conn // Replace SOCKET
	//mRecvBuffer CircularBuffer
	//mSendBuffer CircularBuffer

	mConnected int

	mPlayerSessionId string
	mPlayerName      string
	mScore           int
	mGameLiftManager *GameLiftManager
}

func (ps *PlayerSession) IsValid() bool {
	if len(ps.mPlayerSessionId) > 0 {
		return true
	} else {
		return false
	}
}

func (ps *PlayerSession) PlayerReady(playerSessionId string) {
	if ps.mGameLiftManager.AcceptPlayerSession(ps, playerSessionId) {
		ps.mPlayerSessionId = playerSessionId

		myLogger.Print("Implement PlayerSession  PlalyerReady(). Let's Call this from GameLiftManager module.")

		playerSession, err := GGameLiftManager.DescribePlayerSessions(playerSessionId)
		if err != nil {
			myLogger.Fatal(err.Error())
		}

		myLogger.Print(playerSession.PlayerID)

		ps.mPlayerName = playerSession.PlayerID

		myLogger.Print("[PLAYER] PlayerReady: ", playerSessionId)
		ps.mGameLiftManager.CheckReadyAll()

		return
	}

	/// disconnect unauthed player
	ps.Disconnect(DR_UNAUTH)
}

func (ps *PlayerSession) PlayerExit(playerSessionId string) {
	ps.mGameLiftManager.RemovePlayerSession(ps, playerSessionId)

	ps.mPlayerSessionId = ""

	myLogger.Print("[PLAYER] PlayerExit: ", playerSessionId)

	ps.Disconnect(DR_LOGOUT)
}

func (ps *PlayerSession) OnDisconnect(dr DisconnectReason) {
	if ps.IsValid() {
		GGameLiftManager.RemovePlayerSession(ps, ps.mPlayerSessionId)
		ps.mPlayerSessionId = ""
	}
}

func (ps *PlayerSession) GetPlayerSessionId() string {
	return ps.mPlayerSessionId
}

func (ps *PlayerSession) GetPlayerName() string {
	return ps.mPlayerName
}

func (ps *PlayerSession) GetPlayerScore() int {
	return ps.mScore
}

func checkError(err error) bool {
	if err != nil {
		// TODO for now avoid Fatal error which terminates the process
		//myLogger.Print("Fatal error: ", err.Error())
		return true
	}
	return false
}
