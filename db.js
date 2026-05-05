// ============================================================
// db.js v2.0 - 写真コンテストDBアクセス層
// ============================================================
// 設計方針：
//  - 公開データの取得は public_*_view 経由
//  - 投稿・いいね・コメント・通報は SECURITY DEFINER RPC 経由
//  - 管理操作は host_key を渡す host_* RPC 経由
//  - 識別情報の直接取得は禁止（host_list_photos_with_identifiers のみ）
// ============================================================

(function() {
  'use strict';

  if (!window.SUPABASE_CONFIG) {
    console.error('config.js を先に読み込んでください');
    return;
  }
  const { url, anonKey, bucketName } = window.SUPABASE_CONFIG;
  const BUCKET = bucketName || 'photos';
  const sb = window.supabase.createClient(url, anonKey);

  // ============================================================
  // events
  // ============================================================
  async function getEvent(eventId) {
    // 参加者用：単一イベント取得RPC（draft除外）
    const { data, error } = await sb.rpc('get_public_event', { p_event_id: eventId });
    if (error) throw error;
    return (data && data[0]) || null;
  }

  async function hostGetEvent(eventId, hostKey) {
    // ホスト用：draft含む全状態取得・全カラム
    const { data, error } = await sb.rpc('host_get_event', { p_event_id: eventId, p_host_key: hostKey });
    if (error) throw error;
    return (data && data[0]) || null;
  }

  async function listEvents(adminKey) {
    // 管理画面専用：admin_key 必須
    const { data, error } = await sb.rpc('admin_list_events', { p_admin_key: adminKey });
    if (error) throw error;
    return data || [];
  }

  async function createEvent({ id, name, hostKey, adminKey, theme = '', description = '' }) {
    const { data, error } = await sb.rpc('create_event', {
      p_id: id, p_name: name, p_host_key: hostKey, p_admin_key: adminKey,
      p_theme: theme, p_description: description
    });
    if (error) throw error;
    return data;
  }

  async function verifyAdminKey(adminKey) {
    const { data, error } = await sb.rpc('verify_admin_key', { p_admin_key: adminKey });
    if (error) throw error;
    return data === true;
  }

  async function updateAdminKey(oldKey, newKey) {
    const { data, error } = await sb.rpc('update_admin_key', { p_old_key: oldKey, p_new_key: newKey });
    if (error) throw error;
    return data;
  }

  async function hostUpdateEvent(eventId, hostKey, patch) {
    // patch には許可カラムのみ含める。theme_preset 等もここで保存可能
    const { data, error } = await sb.rpc('host_update_event', {
      p_event_id: eventId, p_host_key: hostKey, p_patch: patch
    });
    if (error) throw error;
    return data;
  }

  async function hostSetAward(eventId, hostKey, photoId, awardTitle) {
    const { data, error } = await sb.rpc('host_set_award', {
      p_event_id: eventId, p_host_key: hostKey, p_photo_id: photoId, p_award_title: awardTitle || ''
    });
    if (error) throw error;
    return data;
  }

  async function hostDeleteEvent(eventId, hostKey, confirmName) {
    const { data, error } = await sb.rpc('host_delete_event', {
      p_event_id: eventId, p_host_key: hostKey, p_confirm_name: confirmName
    });
    if (error) throw error;
    return data;
  }

  // ============================================================
  // photos（参加者用：公開Viewのみ・識別情報含まれない）
  // ============================================================
  async function listPhotos(eventId) {
    const { data, error } = await sb.from('public_photos_view').select('*')
      .eq('event_id', eventId).order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async function listRankings(eventId) {
    const { data, error } = await sb.from('public_rankings_view').select('*')
      .eq('event_id', eventId).order('like_count', { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async function countPhotosForUser(eventId, userId) {
    // user_id が公開Viewに無いので、自分の投稿数はlocalStorageでカウントするのが基本
    // ここではフォールバックとして likes 経由などはせず、localStorage前提
    return null;
  }

  // ============================================================
  // photos（管理者用：識別情報込み）
  // ============================================================
  async function hostListPhotosWithIdentifiers(eventId, hostKey) {
    const { data, error } = await sb.rpc('host_list_photos_with_identifiers', {
      p_event_id: eventId, p_host_key: hostKey
    });
    if (error) throw error;
    return data || [];
  }

  // ============================================================
  // 投稿
  // ============================================================
  async function uploadImage(eventId, file) {
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
    const allowed = ['jpg', 'jpeg', 'png', 'webp'];
    if (!allowed.includes(ext)) {
      throw new Error('対応していない画像形式です。jpg/png/webpのみ対応');
    }
    const ts = Date.now();
    const rand = Math.random().toString(36).slice(2, 10);
    const path = `${eventId}/${ts}_${rand}.${ext}`;
    const { error } = await sb.storage.from(BUCKET).upload(path, file, {
      cacheControl: '3600', upsert: false, contentType: file.type || `image/${ext}`
    });
    if (error) throw error;
    const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
    return { path, url: data.publicUrl };
  }

  async function submitPhoto({ eventId, userId, nickname, imageUrl, storagePath, identifiers = {} }) {
    const { data, error } = await sb.rpc('submit_photo', {
      p_event_id: eventId,
      p_user_id: userId,
      p_nickname: nickname,
      p_image_url: imageUrl,
      p_storage_path: storagePath,
      p_registration_number: identifiers.registration_number || null,
      p_phone: identifiers.phone || null,
      p_employee_id: identifiers.employee_id || null,
      p_email: identifiers.email || null
    });
    if (error) throw error;
    return data;
  }

  // ============================================================
  // いいね
  // ============================================================
  async function getMyLikes(eventId, userId) {
    // 自分のいいねだけ取得（公平性確保のためlikes全件SELECTは廃止）
    const { data, error } = await sb.rpc('get_my_likes', { p_event_id: eventId, p_user_id: userId });
    if (error) throw error;
    return (data || []).map(r => r.photo_id);
  }

  async function addLike(eventId, photoId, userId) {
    const { data, error } = await sb.rpc('add_like', {
      p_event_id: eventId, p_photo_id: photoId, p_user_id: userId
    });
    if (error) throw error;
    return data;
  }

  async function removeLike(eventId, photoId, userId) {
    const { data, error } = await sb.rpc('remove_like', {
      p_event_id: eventId, p_photo_id: photoId, p_user_id: userId
    });
    if (error) throw error;
    return data;
  }

  // ============================================================
  // コメント
  // ============================================================
  async function listComments(eventId) {
    const { data, error } = await sb.from('public_comments_view').select('*')
      .eq('event_id', eventId).order('created_at', { ascending: true });
    if (error) throw error;
    return data || [];
  }

  async function addComment(eventId, photoId, userId, nickname, body) {
    const { data, error } = await sb.rpc('add_comment', {
      p_event_id: eventId, p_photo_id: photoId, p_user_id: userId,
      p_nickname: nickname, p_body: body
    });
    if (error) throw error;
    return data;
  }

  // ============================================================
  // 通報
  // ============================================================
  async function reportPhoto(eventId, photoId, userId, reason = null) {
    const { data, error } = await sb.rpc('report_photo', {
      p_event_id: eventId, p_photo_id: photoId, p_user_id: userId, p_reason: reason
    });
    if (error) throw error;
    return data;
  }

  async function hostListReports(eventId, hostKey) {
    const { data, error } = await sb.rpc('host_list_reports', {
      p_event_id: eventId, p_host_key: hostKey
    });
    if (error) throw error;
    return data || [];
  }

  async function hostResolveReport(eventId, reportId, hostKey, action, reason = null) {
    const { data, error } = await sb.rpc('host_resolve_report', {
      p_event_id: eventId, p_report_id: reportId, p_host_key: hostKey,
      p_action: action, p_reason: reason
    });
    if (error) throw error;
    return data;
  }

  // ============================================================
  // 管理操作（写真・コメント）
  // ============================================================
  async function hostHidePhoto(eventId, photoId, hostKey, reason = null) {
    const { data, error } = await sb.rpc('host_hide_photo', {
      p_event_id: eventId, p_photo_id: photoId, p_host_key: hostKey, p_reason: reason
    });
    if (error) throw error;
    return data;
  }

  async function hostUnhidePhoto(eventId, photoId, hostKey) {
    const { data, error } = await sb.rpc('host_unhide_photo', {
      p_event_id: eventId, p_photo_id: photoId, p_host_key: hostKey
    });
    if (error) throw error;
    return data;
  }

  async function hostDeletePhoto(eventId, photoId, hostKey, reason = null) {
    const { data, error } = await sb.rpc('host_delete_photo', {
      p_event_id: eventId, p_photo_id: photoId, p_host_key: hostKey, p_reason: reason
    });
    if (error) throw error;
    return data;
  }

  async function hostHideComment(eventId, commentId, hostKey, reason = null) {
    const { data, error } = await sb.rpc('host_hide_comment', {
      p_event_id: eventId, p_comment_id: commentId, p_host_key: hostKey, p_reason: reason
    });
    if (error) throw error;
    return data;
  }

  // ============================================================
  // 個人情報削除・クリーンアップ
  // ============================================================
  async function hostClearPersonalData(eventId, hostKey) {
    const { data, error } = await sb.rpc('host_clear_personal_data', {
      p_event_id: eventId, p_host_key: hostKey
    });
    if (error) throw error;
    return data;
  }

  async function hostRunCleanup(eventId, hostKey) {
    const { data, error } = await sb.rpc('host_run_cleanup', {
      p_event_id: eventId, p_host_key: hostKey
    });
    if (error) throw error;
    return data;
  }

  // ============================================================
  // 特別賞（管理用：直接Insert/Update/Deleteは無いので、別途RPC追加が必要）
  // 当面はListだけ公開Viewから取得、編集はevent管理画面でhost_keyあるオペレータ権限内で
  // ============================================================
  async function listSpecials(eventId) {
    const { data, error } = await sb.from('public_specials_view').select('*')
      .eq('event_id', eventId).order('display_order');
    if (error) throw error;
    return data || [];
  }

  // ============================================================
  // Realtime
  // ============================================================
  function subscribeEvent(eventId, callbacks) {
    const channel = sb.channel('event_' + eventId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'photos', filter: `event_id=eq.${eventId}` },
        (payload) => callbacks.onPhotoChange && callbacks.onPhotoChange(payload))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'likes', filter: `event_id=eq.${eventId}` },
        (payload) => callbacks.onLikeChange && callbacks.onLikeChange(payload))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'comments', filter: `event_id=eq.${eventId}` },
        (payload) => callbacks.onCommentChange && callbacks.onCommentChange(payload))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'events', filter: `id=eq.${eventId}` },
        (payload) => callbacks.onEventChange && callbacks.onEventChange(payload))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'specials', filter: `event_id=eq.${eventId}` },
        (payload) => callbacks.onSpecialChange && callbacks.onSpecialChange(payload))
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          if (callbacks.onConnect) callbacks.onConnect();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          if (callbacks.onDisconnect) callbacks.onDisconnect();
          setTimeout(() => {
            sb.removeChannel(channel);
            subscribeEvent(eventId, callbacks);
          }, 5000);
        }
      });
    return channel;
  }

  function unsubscribe(channel) {
    if (channel) sb.removeChannel(channel);
  }

  // ============================================================
  // エクスポート
  // ============================================================
  window.DB = {
    sb,
    // events
    getEvent, hostGetEvent, listEvents, createEvent, hostUpdateEvent, hostDeleteEvent,
    verifyAdminKey, updateAdminKey,
    // photos
    listPhotos, listRankings, countPhotosForUser, hostListPhotosWithIdentifiers,
    hostSetAward,
    // upload + submit
    uploadImage, submitPhoto,
    // likes
    getMyLikes, addLike, removeLike,
    // comments
    listComments, addComment, hostHideComment,
    // reports
    reportPhoto, hostListReports, hostResolveReport,
    // host moderation
    hostHidePhoto, hostUnhidePhoto, hostDeletePhoto,
    // cleanup
    hostClearPersonalData, hostRunCleanup,
    // specials
    listSpecials,
    // realtime
    subscribeEvent, unsubscribe,
  };
})();
